import { Router, Request, Response } from 'express';
import { Types } from 'mongoose';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { authMiddleware } from '../middleware/auth';
import { successResponse, errorResponse } from '../types/api.types';
import { StorageServiceFactory, StorageError } from '../services/storageService';
import { ConfigService } from '../services/configService';
import { StorageType } from '../models/SystemConfig';

const router = Router();

// 确保上传目录存在
const uploadDir = path.join(process.cwd(), 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// 配置multer使用内存存储（便于后续上传到不同存储后端）
const memoryStorage = multer.memoryStorage();

// 配置multer磁盘存储（本地存储时使用）
const diskStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  },
});

// 配置multer（使用内存存储以支持多种存储后端）
const upload = multer({
  storage: memoryStorage,
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB
  },
  fileFilter: (req, file, cb) => {
    // 允许所有文件类型
    cb(null, true);
  },
});

/**
 * 上传文件
 * POST /api/files/upload
 * 支持本地存储和 S3 兼容存储
 */
router.post('/upload', authMiddleware, upload.array('files', 10), async (req: Request, res: Response) => {
  try {
    const userId = req.userId!;

    // 检查是否有文件
    if (!req.files || (req.files as Express.Multer.File[]).length === 0) {
      return res.status(400).json(
        errorResponse('BAD_REQUEST', '没有上传文件')
      );
    }

    const files = req.files as Express.Multer.File[];
    const uploadedFiles = [];

    // 导入User模型
    const User = (await import('../models/User')).default;

    // 获取存储服务
    const storageService = await StorageServiceFactory.getInstance();
    const storageConfig = await ConfigService.getStorageConfig();

    for (const file of files) {
      // 生成文件ID
      const fileId = new Types.ObjectId();

      // 使用存储服务上传文件
      const storageResult = await storageService.upload(
        file.buffer,
        file.originalname,
        file.mimetype
      );

      // 保存文件信息
      const user = await User.findById(userId);
      if (!user) {
        return res.status(404).json(
          errorResponse('NOT_FOUND', '用户不存在')
        );
      }

      // 添加文件到用户的文件列表
      if (!user.files) {
        user.files = [];
      }

      // 根据存储类型生成下载 URL
      let downloadUrl: string;
      if (storageConfig.type === StorageType.S3) {
        // S3 存储直接使用存储服务返回的 URL
        downloadUrl = storageResult.url;
      } else {
        // 本地存储使用 API 下载接口
        downloadUrl = `http://10.42.0.1:${process.env.PORT || 3000}/api/files/${fileId}/download`;
      }

      const fileData = {
        _id: fileId,
        name: file.originalname,
        storedFilename: storageResult.key, // 保存存储键
        size: storageResult.size,
        mimetype: file.mimetype,
        url: downloadUrl,
        createdAt: new Date(),
      };

      user.files.push(fileData);
      await user.save();

      uploadedFiles.push(fileData);
    }

    return res.json(successResponse({
      files: uploadedFiles,
      count: uploadedFiles.length,
    }));
  } catch (error: any) {
    if (error instanceof StorageError) {
      return res.status(500).json(
        errorResponse(error.code, error.message)
      );
    }
    return res.status(500).json(
      errorResponse('INTERNAL_ERROR', error.message || '文件上传失败')
    );
  }
});

/**
 * 获取文件列表
 * GET /api/files
 */
router.get('/', authMiddleware, async (req: Request, res: Response) => {
  try {
    const userId = req.userId!;
    const User = (await import('../models/User')).default;

    const user = await User.findById(userId).select('files');
    if (!user) {
      return res.status(404).json(
        errorResponse('NOT_FOUND', '用户不存在')
      );
    }

    return res.json(successResponse({
      files: user.files || [],
      count: (user.files || []).length,
    }));
  } catch (error: any) {
    return res.status(500).json(
      errorResponse('INTERNAL_ERROR', error.message || '获取文件列表失败')
    );
  }
});

/**
 * 获取文件详情
 * GET /api/files/:id
 */
router.get('/:id', authMiddleware, async (req: Request, res: Response) => {
  try {
    const userId = req.userId!;
    const fileId = req.params.id;
    const User = (await import('../models/User')).default;

    const user = await User.findById(userId).select('files');
    if (!user) {
      return res.status(404).json(
        errorResponse('NOT_FOUND', '用户不存在')
      );
    }

    const file = (user.files || []).find((f: any) => f._id.toString() === fileId);
    if (!file) {
      return res.status(404).json(
        errorResponse('NOT_FOUND', '文件不存在')
      );
    }

    return res.json(successResponse(file));
  } catch (error: any) {
    return res.status(500).json(
      errorResponse('INTERNAL_ERROR', error.message || '获取文件详情失败')
    );
  }
});

/**
 * 下载文件
 * GET /api/files/:id/download
 * 支持两种认证方式：
 * 1. Header: x-liu-token 或 Authorization
 * 2. URL 参数: ?token=xxx
 */
router.get('/:id/download', async (req: Request, res: Response): Promise<void> => {
  try {
    const fileId = req.params.id;
    const User = (await import('../models/User')).default;
    const { JWTUtils } = await import('../utils/jwt');

    // 尝试从多个来源获取 token
    let token = req.headers['x-liu-token'] as string
      || req.headers['authorization']?.replace('Bearer ', '')
      || req.query.token as string;

    // 如果没有 token，尝试公开访问（查找文件所有者）
    let userId: Types.ObjectId | null = null;

    if (token) {
      // 验证 token
      const decoded = JWTUtils.verifyToken(token);
      if (decoded && decoded.userId) {
        userId = new Types.ObjectId(decoded.userId);
      }
    }

    // 如果没有有效的 userId，尝试通过 fileId 查找文件所有者
    if (!userId) {
      // 查找拥有此文件的用户
      const userWithFile = await User.findOne({
        'files._id': new Types.ObjectId(fileId)
      }).select('files');

      if (!userWithFile) {
        res.status(404).json(
          errorResponse('NOT_FOUND', '文件不存在')
        );
        return;
      }

      // 找到文件，允许公开访问
      const file = (userWithFile.files || []).find((f: any) => f._id.toString() === fileId);
      if (!file) {
        res.status(404).json(
          errorResponse('NOT_FOUND', '文件不存在')
        );
        return;
      }

      // 从URL中提取文件名 (优先使用 storedFilename，兼容旧数据使用 name)
      const fileName = (file as any).storedFilename || file.name;
      const filePath = path.join(uploadDir, fileName);

      // 检查文件是否存在
      if (!fs.existsSync(filePath)) {
        res.status(404).json(
          errorResponse('NOT_FOUND', '文件不存在于服务器')
        );
        return;
      }

      // 设置正确的Content-Type
      res.setHeader('Content-Type', file.mimetype || 'application/octet-stream');
      res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(file.name)}"`);
      res.setHeader('Cache-Control', 'public, max-age=31536000'); // 缓存1年
      
      // 发送文件
      res.sendFile(filePath);
      return;
    }

    // 有认证的用户，验证文件所有权
    const user = await User.findById(userId).select('files');
    if (!user) {
      res.status(404).json(
        errorResponse('NOT_FOUND', '用户不存在')
      );
      return;
    }

    const file = (user.files || []).find((f: any) => f._id.toString() === fileId);
    if (!file) {
      // 用户没有这个文件，尝试查找其他用户的文件（公开访问）
      const userWithFile = await User.findOne({
        'files._id': new Types.ObjectId(fileId)
      }).select('files');

      if (!userWithFile) {
        res.status(404).json(
          errorResponse('NOT_FOUND', '文件不存在')
        );
        return;
      }

      const otherFile = (userWithFile.files || []).find((f: any) => f._id.toString() === fileId);
      if (!otherFile) {
        res.status(404).json(
          errorResponse('NOT_FOUND', '文件不存在')
        );
        return;
      }

      // 从URL中提取文件名
      const fileName = (otherFile as any).storedFilename || otherFile.name;
      const filePath = path.join(uploadDir, fileName);

      if (!fs.existsSync(filePath)) {
        res.status(404).json(
          errorResponse('NOT_FOUND', '文件不存在于服务器')
        );
        return;
      }

      res.setHeader('Content-Type', otherFile.mimetype || 'application/octet-stream');
      res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(otherFile.name)}"`);
      res.setHeader('Cache-Control', 'public, max-age=31536000');
      
      res.sendFile(filePath);
      return;
    }

    // 从URL中提取文件名 (优先使用 storedFilename，兼容旧数据使用 name)
    const fileName = (file as any).storedFilename || file.name;
    const filePath = path.join(uploadDir, fileName);

    // 检查文件是否存在
    if (!fs.existsSync(filePath)) {
      res.status(404).json(
        errorResponse('NOT_FOUND', '文件不存在于服务器')
      );
      return;
    }

    // 设置正确的Content-Type
    res.setHeader('Content-Type', file.mimetype || 'application/octet-stream');
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(file.name)}"`);
    res.setHeader('Cache-Control', 'public, max-age=31536000');
    
    // 发送文件
    res.sendFile(filePath);
  } catch (error: any) {
    console.error('File download error:', error);
    res.status(500).json(
      errorResponse('INTERNAL_ERROR', error.message || '文件下载失败')
    );
  }
});

/**
 * 删除文件
 * DELETE /api/files/:id
 */
router.delete('/:id', authMiddleware, async (req: Request, res: Response) => {
  try {
    const userId = req.userId!;
    const fileId = req.params.id;
    const User = (await import('../models/User')).default;

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json(
        errorResponse('NOT_FOUND', '用户不存在')
      );
    }

    if (!user.files) {
      return res.status(404).json(
        errorResponse('NOT_FOUND', '文件列表为空')
      );
    }

    const fileIndex = (user.files || []).findIndex((f: any) => f._id.toString() === fileId);
    if (fileIndex === -1) {
      return res.status(404).json(
        errorResponse('NOT_FOUND', '文件不存在')
      );
    }

    // 获取存储服务并删除文件
    const file = user.files[fileIndex];
    try {
      const storageService = await StorageServiceFactory.getInstance();
      const storedFilename = (file as any).storedFilename || file.name;
      await storageService.delete(storedFilename);
    } catch (storageError) {
      // 存储删除失败不影响数据库记录删除
      console.warn('存储文件删除失败:', storageError);
    }

    user.files.splice(fileIndex, 1);
    await user.save();

    return res.json(successResponse({
      message: '文件删除成功',
    }));
  } catch (error: any) {
    return res.status(500).json(
      errorResponse('INTERNAL_ERROR', error.message || '文件删除失败')
    );
  }
});

export default router;
