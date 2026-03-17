import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { aiConfig, AIModel } from '../config/ai';
import SystemConfig from '../models/SystemConfig';

export interface AIMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface AIResponse {
  content: string;
  model: string;
  tokensUsed: number;
  cost?: number;
}

export class AIService {
  private openai: OpenAI | null = null;
  private anthropic: Anthropic | null = null;
  private gemini: GoogleGenerativeAI | null = null;

  constructor() {
    this.initFromEnv();
  }

  private initFromEnv(): void {
    if (aiConfig.openai.apiKey) {
      this.openai = new OpenAI({
        apiKey: aiConfig.openai.apiKey,
        baseURL: aiConfig.openai.baseURL,
      });
    }
    if (aiConfig.anthropic.apiKey) {
      this.anthropic = new Anthropic({
        apiKey: aiConfig.anthropic.apiKey,
        baseURL: aiConfig.anthropic.baseURL,
      });
    }
    if (aiConfig.gemini.apiKey) {
      this.gemini = new GoogleGenerativeAI(aiConfig.gemini.apiKey);
    }
  }

  async reloadProviders(): Promise<void> {
    try {
      const config = await SystemConfig.getConfig();
      const providers = config.ai?.providers || [];

      this.openai = null;
      this.anthropic = null;
      this.gemini = null;

      for (const provider of providers) {
        if (!provider.enabled) continue;
        if (!provider.apiKey) continue; // 跳过没有 apiKey 的 provider

        const name = provider.name.toLowerCase();
        if (name.includes('claude') || name.includes('anthropic')) {
          this.anthropic = new Anthropic({
            apiKey: provider.apiKey,
            baseURL: provider.baseUrl,
          });
        } else if (name.includes('gemini') || name.includes('google')) {
          this.gemini = new GoogleGenerativeAI(provider.apiKey);
        } else {
          // Treat all other providers as OpenAI-compatible (SiliconFlow, DeepSeek, etc.)
          this.openai = new OpenAI({
            apiKey: provider.apiKey,
            baseURL: provider.baseUrl,
          });
        }
      }

      // Fallback to env config if no DB providers loaded
      if (!this.openai && !this.anthropic && !this.gemini) {
        this.initFromEnv();
      }
    } catch (error) {
      console.error('重新加载AI提供商失败，使用环境变量配置:', error);
      this.initFromEnv();
    }
  }

  /**
   * 调用OpenAI
   */
  async callOpenAI(
    messages: AIMessage[],
    model: string = aiConfig.openai.defaultModel,
    temperature: number = 0.7,
    maxTokens: number = 1000
  ): Promise<AIResponse> {
    if (!this.openai) {
      throw new Error('OpenAI未配置');
    }

    try {
      const baseURL = (aiConfig.openai.baseURL || '').replace(/\/+$/, '');
      const endpoint = `${baseURL}/chat/completions`;
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${aiConfig.openai.apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages,
          temperature,
          max_tokens: maxTokens,
        }),
      });
      const data = await res.json() as any;
      if (!res.ok) {
        throw new Error(data?.error?.message || `HTTP ${res.status}`);
      }
      return {
        content: data.choices?.[0]?.message?.content || '',
        model: data.model || model,
        tokensUsed: data.usage?.total_tokens || 0,
        cost: this.calculateCost(data.usage?.total_tokens || 0, model),
      };
    } catch (error: any) {
      console.error('OpenAI调用失败:', error);
      throw new Error(`OpenAI调用失败: ${error.message}`);
    }
  }

  private async callOpenAIResponses(
    messages: AIMessage[],
    model: string,
    temperature: number,
    maxTokens: number
  ): Promise<AIResponse> {
    if (!this.openai) throw new Error('OpenAI未配置');

    const input = messages.map(m => ({
      role: m.role as 'user' | 'assistant' | 'system',
      content: m.content,
    }));

    try {
      // Non-streaming first
      const response = await this.openai.responses.create({
        model,
        input,
        temperature,
        max_output_tokens: maxTokens,
        stream: false,
      } as any);

      const outputText = (response as any).output
        ?.filter((item: any) => item.type === 'message')
        ?.flatMap((item: any) => item.content || [])
        ?.filter((part: any) => part.type === 'output_text')
        ?.map((part: any) => part.text)
        ?.join('') || '';

      const usage = (response as any).usage || {};
      const totalTokens = (usage.input_tokens || 0) + (usage.output_tokens || 0);

      return {
        content: outputText,
        model,
        tokensUsed: totalTokens,
        cost: this.calculateCost(totalTokens, model),
      };
    } catch (nonStreamError: any) {
      // Proxy may require streaming — collect streamed chunks
      if (nonStreamError.message?.includes('Stream must be set to true') || nonStreamError.status === 400) {
        const stream = await this.openai.responses.create({
          model,
          input,
          temperature,
          max_output_tokens: maxTokens,
          stream: true,
        } as any);

        let outputText = '';
        let totalTokens = 0;

        for await (const event of stream as any) {
          if (event.type === 'response.output_text.delta') {
            outputText += event.delta || '';
          } else if (event.type === 'response.completed') {
            const usage = event.response?.usage || {};
            totalTokens = (usage.input_tokens || 0) + (usage.output_tokens || 0);
          }
        }

        return { content: outputText, model, tokensUsed: totalTokens, cost: this.calculateCost(totalTokens, model) };
      }
      throw nonStreamError;
    }
  }

  /**
   * 调用Anthropic Claude
   */
  async callClaude(
    messages: AIMessage[],
    model: string = aiConfig.anthropic.defaultModel,
    temperature: number = 0.7,
    maxTokens: number = 1000
  ): Promise<AIResponse> {
    if (!this.anthropic) {
      throw new Error('Anthropic未配置');
    }

    try {
      const systemMsg = messages.find(m => m.role === 'system');
      const nonSystemMsgs = messages.filter(m => m.role !== 'system');

      const completion = await this.anthropic.messages.create({
        model,
        max_tokens: maxTokens,
        temperature,
        ...(systemMsg ? { system: systemMsg.content } : {}),
        messages: nonSystemMsgs.map(m => ({
          role: m.role as 'user' | 'assistant',
          content: m.content,
        })),
      });

      // Find the first text block (skip thinking blocks from extended thinking mode)
      const textBlock = completion.content.find((b): b is { type: 'text'; text: string } => b.type === 'text');
      const claudeText = textBlock?.text ?? '';
      return {
        content: claudeText,
        model: completion.model,
        tokensUsed: completion.usage?.input_tokens + completion.usage?.output_tokens || 0,
        cost: this.calculateCost(
          completion.usage?.input_tokens + completion.usage?.output_tokens || 0,
          model
        ),
      };
    } catch (error: any) {
      console.error('Claude调用失败:', error);
      throw new Error(`Claude调用失败: ${error.message}`);
    }
  }

  /**
   * 调用Gemini
   */
  async callGemini(
    messages: AIMessage[],
    model: string = aiConfig.gemini.defaultModel,
    temperature: number = 0.7,
    maxTokens: number = 1000
  ): Promise<AIResponse> {
    if (!this.gemini) {
      throw new Error('Gemini未配置');
    }

    try {
      const geminiModel = this.gemini.getGenerativeModel({ model });

      // 合并所有消息
      const prompt = messages.map(m => `${m.role}: ${m.content}`).join('\n');

      const result = await geminiModel.generateContent(prompt);
      const response = await result.response;

      return {
        content: response.text() || '',
        model,
        tokensUsed: response.usageMetadata?.totalTokenCount || 0,
        cost: 0, // Gemini定价待确认
      };
    } catch (error: any) {
      console.error('Gemini调用失败:', error);
      throw new Error(`Gemini调用失败: ${error.message}`);
    }
  }

  /**
   * 统一AI调用接口
   */
  async callAI(
    messages: AIMessage[],
    model: AIModel,
    temperature: number = 0.7,
    maxTokens: number = 1000
  ): Promise<AIResponse> {
    if (model.startsWith('gpt') || model.startsWith('deepseek')) {
      return this.callOpenAI(messages, model, temperature, maxTokens);
    } else if (model.startsWith('claude')) {
      return this.callClaude(messages, model, temperature, maxTokens);
    } else if (model.startsWith('gemini')) {
      return this.callGemini(messages, model, temperature, maxTokens);
    } else {
      // Fallback: route unknown models to the first available provider
      if (this.anthropic) {
        return this.callClaude(messages, model, temperature, maxTokens);
      } else if (this.openai) {
        return this.callOpenAI(messages, model, temperature, maxTokens);
      } else if (this.gemini) {
        return this.callGemini(messages, model, temperature, maxTokens);
      }
      throw new Error('没有可用的AI服务，请检查API配置');
    }
  }

  /**
   * 计算费用
   */
  private calculateCost(tokens: number, model: string): number {
    // 简化的费用计算，实际应根据各AI提供商的最新定价
    const pricing: Record<string, { input: number; output: number }> = {
      'gpt-4': { input: 0.03, output: 0.06 },
      'gpt-3.5-turbo': { input: 0.0015, output: 0.002 },
      'claude-3-sonnet-20240229': { input: 0.003, output: 0.015 },
      'claude-3-opus-20240229': { input: 0.015, output: 0.075 },
    };

    const modelPricing = pricing[model];
    if (!modelPricing) return 0;

    // 假设50%输入，50%输出
    return (tokens * 0.5 * modelPricing.input) + (tokens * 0.5 * modelPricing.output);
  }
}

let _instance: AIService | null = null;

export function getAIService(): AIService {
  if (!_instance) {
    _instance = new AIService();
  }
  return _instance;
}

export const aiService = new Proxy({} as AIService, {
  get(_target, prop: string) {
    return (getAIService() as any)[prop];
  },
});
