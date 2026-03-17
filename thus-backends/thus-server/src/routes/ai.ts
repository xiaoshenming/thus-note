import { Router, Request, Response } from 'express';
import { authMiddleware } from '../middleware/auth';
import { successResponse, errorResponse } from '../types/api.types';
import { aiService } from '../services/aiService';
import { aiConfig } from '../config/ai';
import AIUsageModel, { AIModel } from '../models/AIUsage';
import Thread from '../models/Thread';
import User from '../models/User';

const router = Router();

/**
 * AI提示词类型
 */
export enum AIPromptType {
  WRITING = 'writing',
  SUMMARIZATION = 'summarization',
  ANALYSIS = 'analysis',
  TRANSLATION = 'translation',
  CODE_GENERATION = 'code_generation',
  QUESTION_ANSWERING = 'question_answering',
}

/**
 * AI模型类型
 */
export enum AIModelType {
  GPT_4 = 'gpt-4',
  GPT_3_5_TURBO = 'gpt-3.5-turbo',
  CLAUDE_3 = 'claude-3',
  GEMINI = 'gemini',
  LOCAL = 'local',
}

/**
 * AI请求接口
 */
interface AIRequest {
  prompt: string;
  model?: AIModelType;
  type?: AIPromptType;
  context?: string;
  temperature?: number;
  maxTokens?: number;
}

/**
 * AI响应接口
 */
interface AIResponse {
  content: string;
  model: AIModelType;
  tokensUsed: number;
  cost?: number;
}

/**
 * AI聊天消息接口
 */
interface AIMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/**
 * 发送AI提示
 * POST /api/ai/prompt
 */
router.post('/prompt', authMiddleware, async (req: Request, res: Response) => {
  try {
    const userId = req.userId!;
    const { prompt, model = AIModelType.GPT_3_5_TURBO, type = AIPromptType.WRITING, context, temperature = 0.7, maxTokens = 1000 } = req.body as AIRequest;

    // 验证必需参数
    if (!prompt) {
      return res.status(400).json(
        errorResponse('BAD_REQUEST', '提示词不能为空')
      );
    }

    // 构建AI请求
    const messages: AIMessage[] = [
      {
        role: 'system',
        content: getSystemPrompt(type),
      },
    ];

    // 添加上下文（如果有）
    if (context) {
      messages.push({
        role: 'user',
        content: `上下文：${context}\n\n问题：${prompt}`,
      });
    } else {
      messages.push({
        role: 'user',
        content: prompt,
      });
    }

    // 调用AI服务
    const aiResponse = await callAIService(messages, model, temperature, maxTokens);

    // 保存AI使用记录
    await saveAIUsage(userId, prompt, aiResponse, model, type);

    return res.json(successResponse({
      content: aiResponse.content,
      model: aiResponse.model,
      tokensUsed: aiResponse.tokensUsed,
      cost: aiResponse.cost,
    }));
  } catch (error: any) {
    console.error('AI请求失败:', error);
    return res.status(500).json(
      errorResponse('INTERNAL_ERROR', error.message || 'AI请求失败')
    );
  }
});

/**
 * AI内容总结
 * POST /api/ai/summarize
 */
router.post('/summarize', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { content, maxLength = 200 } = req.body;

    if (!content) {
      return res.status(400).json(
        errorResponse('BAD_REQUEST', '内容不能为空')
      );
    }

    const messages: AIMessage[] = [
      {
        role: 'system',
        content: '你是「如是」笔记系统的 AI 摘要助手。请用简洁、自然的语言总结笔记核心内容，保留关键信息和要点。输出纯文本，不使用 markdown 格式。',
      },
      {
        role: 'user',
        content: `请将以下笔记内容总结为${maxLength}字以内的摘要：\n\n${content}`,
      },
    ];

    const aiResponse = await callAIService(messages, AIModelType.GPT_3_5_TURBO, 0.3, 500);

    return res.json(successResponse({
      summary: aiResponse.content,
      originalLength: content.length,
      summaryLength: aiResponse.content.length,
    }));
  } catch (error: any) {
    console.error('AI总结失败:', error);
    return res.status(500).json(
      errorResponse('INTERNAL_ERROR', error.message || 'AI总结失败')
    );
  }
});

/**
 * AI内容分析
 * POST /api/ai/analyze
 */
router.post('/analyze', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { content, analysisType = 'sentiment' } = req.body;

    if (!content) {
      return res.status(400).json(
        errorResponse('BAD_REQUEST', '内容不能为空')
      );
    }

    const systemPrompts: Record<string, string> = {
      sentiment: '你是一个情感分析专家，能够分析文本的情感倾向（正面、负面、中性）。',
      keywords: '你是一个关键词提取专家，能够从文本中提取最重要的关键词。',
      topics: '你是一个主题分析专家，能够识别文本中的主要主题。',
      summary: '你是一个内容分析专家，能够分析文本的核心观点和结构。',
    };

    const messages: AIMessage[] = [
      {
        role: 'system',
        content: systemPrompts[analysisType] || systemPrompts.sentiment,
      },
      {
        role: 'user',
        content: `请分析以下内容：\n\n${content}`,
      },
    ];

    const aiResponse = await callAIService(messages, AIModelType.GPT_3_5_TURBO, 0.5, 500);

    return res.json(successResponse({
      analysisType,
      result: aiResponse.content,
    }));
  } catch (error: any) {
    console.error('AI分析失败:', error);
    return res.status(500).json(
      errorResponse('INTERNAL_ERROR', error.message || 'AI分析失败')
    );
  }
});

/**
 * AI翻译
 * POST /api/ai/translate
 */
router.post('/translate', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { content, targetLanguage = 'English' } = req.body;

    if (!content) {
      return res.status(400).json(
        errorResponse('BAD_REQUEST', '内容不能为空')
      );
    }

    const messages: AIMessage[] = [
      {
        role: 'system',
        content: `你是一个专业的翻译助手，能够准确地将文本翻译为${targetLanguage}。`,
      },
      {
        role: 'user',
        content: `请将以下内容翻译为${targetLanguage}：\n\n${content}`,
      },
    ];

    const aiResponse = await callAIService(messages, AIModelType.GPT_3_5_TURBO, 0.3, 1000);

    return res.json(successResponse({
      originalContent: content,
      translatedContent: aiResponse.content,
      targetLanguage,
    }));
  } catch (error: any) {
    console.error('AI翻译失败:', error);
    return res.status(500).json(
      errorResponse('INTERNAL_ERROR', error.message || 'AI翻译失败')
    );
  }
});

/**
 * AI代码生成
 * POST /api/ai/code
 */
router.post('/code', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { description, language = 'JavaScript', framework } = req.body;

    if (!description) {
      return res.status(400).json(
        errorResponse('BAD_REQUEST', '描述不能为空')
      );
    }

    let systemPrompt = `你是一个专业的${language}程序员，能够根据描述生成高质量、可运行的代码。`;
    if (framework) {
      systemPrompt += ` 使用${framework}框架。`;
    }

    const messages: AIMessage[] = [
      {
        role: 'system',
        content: systemPrompt,
      },
      {
        role: 'user',
        content: `请根据以下描述生成${language}代码：\n\n${description}`,
      },
    ];

    const aiResponse = await callAIService(messages, AIModelType.GPT_4, 0.2, 2000);

    return res.json(successResponse({
      code: aiResponse.content,
      language,
      framework,
    }));
  } catch (error: any) {
    console.error('AI代码生成失败:', error);
    return res.status(500).json(
      errorResponse('INTERNAL_ERROR', error.message || 'AI代码生成失败')
    );
  }
});

/**
 * AI问答
 * POST /api/ai/chat
 */
router.post('/chat', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { messages, model = AIModelType.GPT_3_5_TURBO, temperature = 0.7, maxTokens = 1000 } = req.body;

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json(
        errorResponse('BAD_REQUEST', '消息列表不能为空')
      );
    }

    // 添加系统提示
    const systemMessage: AIMessage = {
      role: 'system',
      content: '你是如是(Thus-Note)的AI助手，帮助用户进行笔记管理、内容创作、信息分析等任务。',
    };

    const allMessages = [systemMessage, ...messages];

    const aiResponse = await callAIService(allMessages, model, temperature, maxTokens);

    return res.json(successResponse({
      content: aiResponse.content,
      model: aiResponse.model,
      tokensUsed: aiResponse.tokensUsed,
    }));
  } catch (error: any) {
    console.error('AI问答失败:', error);
    return res.status(500).json(
      errorResponse('INTERNAL_ERROR', error.message || 'AI问答失败')
    );
  }
});

/**
 * AI自动标签
 * POST /api/ai/auto-tag
 */
router.post('/auto-tag', authMiddleware, async (req: Request, res: Response) => {
  try {
    const userId = req.userId!;
    const { content, threadId, existingTags = [] } = req.body;

    if (!content) {
      return res.status(400).json(
        errorResponse('BAD_REQUEST', '内容不能为空')
      );
    }

    const user = await User.findById(userId).select('settings');
    const tagCount = user?.settings?.aiTagCount ?? 5;
    const tagStyle = user?.settings?.aiTagStyle ?? 'concise';
    const favoriteTags: string[] = user?.settings?.aiFavoriteTags ?? [];

    const styleDesc = tagStyle === 'concise'
      ? '每个标签 2-4 个字，精简凝练'
      : '每个标签 4-8 个字，描述具体详细';

    let favoriteHint = '';
    if (favoriteTags.length > 0) {
      favoriteHint = `\n7. 用户偏好标签供参考（可优先使用或生成风格相似的标签）：${favoriteTags.join('、')}`;
    }

    const messages: AIMessage[] = [
      {
        role: 'system',
        content: `你是「如是」笔记系统的 AI 标签助手。你的任务是根据笔记内容生成精准、有层次的标签。

规则：
1. 生成 ${tagCount} 个标签，按相关度从高到低排列
2. 标签应涵盖：主题领域、具体概念、内容类型（如"学习笔记""读书摘录""日常记录""灵感""待办"等）
3. 标签语言与笔记内容一致（中文内容用中文标签，英文内容用英文标签，混合则两种都可）
4. ${styleDesc}，避免过于宽泛（如"生活""其他"）
5. 如果内容涉及技术，可用技术术语作标签（如"Vue3""Python""数据库"）
6. 只返回 JSON 数组，如：["标签1","标签2","标签3"]，不要返回任何其他内容${favoriteHint}`,
      },
      {
        role: 'user',
        content: existingTags.length > 0
          ? `用户已有标签：${existingTags.join('、')}\n\n请为以下笔记内容补充新标签（避免与已有标签重复或含义重叠）：\n\n${content.substring(0, 2000)}`
          : `请为以下笔记内容生成标签：\n\n${content.substring(0, 2000)}`,
      },
    ];

    const aiResponse = await callAIService(messages, AIModelType.GPT_3_5_TURBO, 0.3, 500);

    let tags: string[] = [];
    const rawContent = aiResponse.content.replace(/```[a-z]*\n?/g, '').replace(/```/g, '').trim();
    try {
      const parsed = JSON.parse(rawContent);
      tags = Array.isArray(parsed) ? parsed.filter((t: unknown) => typeof t === 'string').slice(0, tagCount) : [];
    } catch {
      // 容错：尝试从文本中提取标签
      tags = rawContent
        .replace(/[\[\]"'`]/g, '')
        .split(/[,，、\n]/)
        .map((t: string) => t.trim())
        .filter((t: string) => t.length > 0 && t.length <= 20)
        .slice(0, tagCount);
    }

    await saveAIUsage(userId, `auto-tag: ${content.substring(0, 100)}`, aiResponse, AIModelType.GPT_3_5_TURBO, AIPromptType.ANALYSIS);

    return res.json(successResponse({
      tags,
      threadId: threadId || null,
    }));
  } catch (error: any) {
    console.error('AI自动标签失败:', error);
    return res.status(500).json(
      errorResponse('INTERNAL_ERROR', error.message || 'AI自动标签失败')
    );
  }
});

/**
 * AI相似笔记推荐
 * POST /api/ai/similar
 */
router.post('/similar', authMiddleware, async (req: Request, res: Response) => {
  try {
    const userId = req.userId!;
    const { content, threadId, limit = 5 } = req.body;

    if (!content) {
      return res.status(400).json(
        errorResponse('BAD_REQUEST', '内容不能为空')
      );
    }

    // 获取用户所有笔记的摘要用于匹配
    const userThreads = await Thread.find({
      userId,
      oState: { $ne: 'DELETED' },
      ...(threadId ? { _id: { $ne: threadId } } : {}),
    })
      .select('_id title firstText tagSearched')
      .limit(50)
      .lean();

    if (userThreads.length === 0) {
      return res.json(successResponse({ similar: [] }));
    }

    const threadSummaries = userThreads.map((t: any, i: number) =>
      `[${i}] ${t.title || ''} ${(t.firstText || '').substring(0, 100)} 标签:${(t.tagSearched || []).join(',')}`
    ).join('\n');

    const messages: AIMessage[] = [
      {
        role: 'system',
        content: `你是「如是」笔记系统的相似度分析助手。根据目标笔记内容，从候选列表中找出主题、领域或观点最相似的笔记。综合考虑内容语义、标签重叠和主题关联度。只返回 JSON 数组，包含候选编号（从0开始），按相似度降序排列。最多返回${limit}个。格式如：[0,3,1]。不要返回其他内容。`,
      },
      {
        role: 'user',
        content: `目标内容：\n${content.substring(0, 1000)}\n\n候选笔记列表：\n${threadSummaries}`,
      },
    ];

    const aiResponse = await callAIService(messages, AIModelType.GPT_3_5_TURBO, 0.2, 200);

    let similarIndices: number[] = [];
    try {
      const parsed = JSON.parse(aiResponse.content);
      similarIndices = Array.isArray(parsed)
        ? parsed.filter((i: unknown) => typeof i === 'number' && i >= 0 && i < userThreads.length)
        : [];
    } catch {
      similarIndices = [];
    }

    const similar = similarIndices.slice(0, limit).map((idx: number) => ({
      _id: userThreads[idx]._id,
      title: (userThreads[idx] as any).title || '',
      firstText: ((userThreads[idx] as any).firstText || '').substring(0, 200),
      tags: (userThreads[idx] as any).tagSearched || [],
    }));

    return res.json(successResponse({ similar }));
  } catch (error: any) {
    console.error('AI相似推荐失败:', error);
    return res.status(500).json(
      errorResponse('INTERNAL_ERROR', error.message || 'AI相似推荐失败')
    );
  }
});

/**
 * 批量为无标签笔记打标签
 * POST /api/ai/batch-retag
 */
router.post('/batch-retag', authMiddleware, async (req: Request, res: Response) => {
  try {
    const userId = req.userId!;
    const { retagAll = false } = req.body;

    const user = await User.findById(userId).select('settings');
    const tagCount = user?.settings?.aiTagCount ?? 5;
    const tagStyle = user?.settings?.aiTagStyle ?? 'concise';
    const favoriteTags: string[] = user?.settings?.aiFavoriteTags ?? [];

    const styleDesc = tagStyle === 'concise'
      ? '每个标签 2-4 个字，精简凝练'
      : '每个标签 4-8 个字，描述具体详细';

    let favoriteHint = '';
    if (favoriteTags.length > 0) {
      favoriteHint = `\n7. 用户偏好标签供参考（可优先使用或生成风格相似的标签）：${favoriteTags.join('、')}`;
    }

    const query: any = {
      userId,
      oState: { $ne: 'DELETED' },
    };

    if (!retagAll) {
      query.$or = [
        { tagSearched: { $exists: false } },
        { tagSearched: { $size: 0 } },
        { tagSearched: null },
      ];
    }

    const threads = await Thread.find(query)
      .select('_id title thusDesc description')
      .limit(retagAll ? 200 : 50)
      .lean();

    if (threads.length === 0) {
      return res.json(successResponse({ tagged: 0, total: 0, results: [] }));
    }

    const results: Array<{ threadId: string; tags: string[] }> = [];

    for (const thread of threads) {
      let content = '';
      if (thread.title) content += thread.title + '\n';
      if (thread.thusDesc && Array.isArray(thread.thusDesc)) {
        for (const node of thread.thusDesc) {
          if (node.text) content += node.text + '\n';
        }
      }
      if (!content && (thread as any).description) {
        content = (thread as any).description;
      }

      if (!content || content.trim().length < 10) continue;

      const messages: AIMessage[] = [
        {
          role: 'system',
          content: `你是「如是」笔记系统的 AI 标签助手。你的任务是根据笔记内容生成精准、有层次的标签。

规则：
1. 生成 ${tagCount} 个标签，按相关度从高到低排列
2. 标签应涵盖：主题领域、具体概念、内容类型
3. 标签语言与笔记内容一致
4. ${styleDesc}
5. 如果内容涉及技术，可用技术术语作标签
6. 只返回 JSON 数组，如：["标签1","标签2","标签3"]${favoriteHint}`,
        },
        {
          role: 'user',
          content: `请为以下笔记内容生成标签：\n\n${content.substring(0, 2000)}`,
        },
      ];

      try {
        const aiResponse = await callAIService(messages, AIModelType.GPT_3_5_TURBO, 0.3, 200);
        let tags: string[] = [];
        try {
          const parsed = JSON.parse(aiResponse.content);
          tags = Array.isArray(parsed) ? parsed.filter((t: unknown) => typeof t === 'string') : [];
        } catch {
          tags = aiResponse.content
            .replace(/[\[\]"']/g, '')
            .split(/[,，、\n]/)
            .map((t: string) => t.trim())
            .filter((t: string) => t.length > 0 && t.length <= 20);
        }

        if (tags.length > 0) {
          await Thread.findByIdAndUpdate(thread._id, {
            tagSearched: tags,
          });
          results.push({ threadId: String(thread._id), tags });
        }
      } catch {
        // skip failed threads
      }
    }

    return res.json(successResponse({
      tagged: results.length,
      total: threads.length,
      results,
    }));
  } catch (error: any) {
    console.error('批量打标签失败:', error);
    return res.status(500).json(
      errorResponse('INTERNAL_ERROR', error.message || '批量打标签失败')
    );
  }
});

/**
 * 获取系统提示词
 */
function getSystemPrompt(type: AIPromptType): string {
  const prompts: Record<AIPromptType, string> = {
    [AIPromptType.WRITING]: '你是一个专业的写作助手，能够帮助用户创作高质量的内容。',
    [AIPromptType.SUMMARIZATION]: '你是一个专业的内容总结助手，能够准确、简洁地总结长文本内容。',
    [AIPromptType.ANALYSIS]: '你是一个专业的内容分析助手，能够深入分析文本并提供有价值的见解。',
    [AIPromptType.TRANSLATION]: '你是一个专业的翻译助手，能够准确地进行多语言翻译。',
    [AIPromptType.CODE_GENERATION]: '你是一个专业的程序员，能够根据需求生成高质量、可运行的代码。',
    [AIPromptType.QUESTION_ANSWERING]: '你是一个知识渊博的问答助手，能够准确回答各种问题。',
  };

  return prompts[type] || prompts[AIPromptType.WRITING];
}

/**
 * 调用AI服务
 */
async function callAIService(
  messages: AIMessage[],
  model: AIModelType,
  temperature: number,
  maxTokens: number
): Promise<AIResponse> {
  try {
    // 优先使用有配置的那个 provider
    const hasOpenAI = Boolean(aiConfig.openai.apiKey);
    const hasAnthropic = Boolean(aiConfig.anthropic.apiKey);

    let defaultModel: string;
    if (hasAnthropic) {
      defaultModel = aiConfig.anthropic.defaultModel;
    } else if (hasOpenAI) {
      defaultModel = aiConfig.openai.defaultModel;
    } else {
      defaultModel = 'deepseek-ai/DeepSeek-V3';
    }

    const modelMapping: Record<AIModelType, string> = {
      [AIModelType.GPT_4]: defaultModel,
      [AIModelType.GPT_3_5_TURBO]: defaultModel,
      [AIModelType.CLAUDE_3]: defaultModel,
      [AIModelType.GEMINI]: 'gemini-pro',
      [AIModelType.LOCAL]: 'local',
    };

    const actualModel = modelMapping[model] || defaultModel;

    const aiResult = await aiService.callAI(messages, actualModel as any, temperature, maxTokens);

    return {
      content: aiResult.content,
      model,
      tokensUsed: aiResult.tokensUsed,
      cost: aiResult.cost,
    };
  } catch (error: any) {
    console.error('AI服务调用失败:', error);
    // 如果AI服务调用失败，返回错误信息
    return {
      content: `AI服务暂时不可用: ${error.message || '未知错误'}`,
      model,
      tokensUsed: 0,
      cost: 0,
    };
  }
}

/**
 * 保存AI使用记录（可选）
 */
async function saveAIUsage(
  userId: any,
  prompt: string,
  response: AIResponse,
  model: AIModelType,
  type: AIPromptType
): Promise<void> {
  try {
    const aiUsage = new AIUsageModel({
      userId,
      model: actualModelTypeToAIModel(model),
      operationType: type,
      inputTokens: response.tokensUsed || 0,
      outputTokens: 0,
      totalTokens: response.tokensUsed || 0,
      prompt: prompt.substring(0, 500),
      response: response.content?.substring(0, 500),
      metadata: {
        cost: response.cost,
        temperature: 0.7,
      },
    });
    await aiUsage.save();
    console.log(`✅ AI使用记录已保存: 用户=${userId}, 模型=${model}, 类型=${type}`);
  } catch (error) {
    console.error('❌ 保存AI使用记录失败:', error);
    // 不抛出错误，避免影响主流程
  }
}

/**
 * 将 AIModelType 转换为 AIModel
 */
function actualModelTypeToAIModel(modelType: AIModelType): string {
  const mapping: Record<AIModelType, string> = {
    [AIModelType.GPT_4]: 'gpt-4',
    [AIModelType.GPT_3_5_TURBO]: 'gpt-3.5-turbo',
    [AIModelType.CLAUDE_3]: 'claude-3-sonnet-20240229',
    [AIModelType.GEMINI]: 'gemini-pro',
    [AIModelType.LOCAL]: 'local',
  };
  return mapping[modelType] || 'gpt-3.5-turbo';
}

export default router;
