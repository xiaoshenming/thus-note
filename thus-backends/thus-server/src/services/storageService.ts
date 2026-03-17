import fs from 'fs';
import path from 'path';
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { Readable } from 'stream';
import { logger } from '../config/logger';
import { ConfigService } from './configService';
import {
  IStorageConfig,
  IS3StorageConfig,
  StorageType,
  S3Provider,
} from '../models/SystemConfig';

/**
 * 存储结果接口
 */
export interface StorageResult {
  key: string;
  url: string;
  size: number;
}

/**
 * 存储服务接口
 */
export interface IStorageService {
  upload(file: Buffer, filename: string, mimetype: string): Promise<StorageResult>;
  download(key: string): Promise<Buffer>;
  delete(key: string): Promise<boolean>;
  getUrl(key: string): string;
}

/**
 * 存储服务错误
 */
export class StorageError extends Error {
  public code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'StorageError';
    this.code = code;
  }
}

/**
 * 本地存储服务实现
 */
export class LocalStorageService implements IStorageService {
  private uploadDir: string;
  private baseUrl: string;

  constructor(uploadDir: string = 'uploads', baseUrl: string = 'http://10.42.0.1:3000') {
    this.uploadDir = uploadDir;
    this.baseUrl = baseUrl;
    
    // 确保上传目录存在
    if (!fs.existsSync(this.uploadDir)) {
      fs.mkdirSync(this.uploadDir, { recursive: true });
    }
  }

  /**
   * 上传文件到本地
   */
  async upload(file: Buffer, filename: string, _mimetype: string): Promise<StorageResult> {
    try {
      // 生成唯一文件名
      const ext = path.extname(filename);
      const uniqueFilename = `${Date.now()}-${Math.floor(Math.random() * 1000000000)}${ext}`;
      const filePath = path.join(this.uploadDir, uniqueFilename);
      
      // 写入文件
      await fs.promises.writeFile(filePath, file);
      
      const result: StorageResult = {
        key: uniqueFilename,
        url: this.getUrl(uniqueFilename),
        size: file.length,
      };
      
      logger.info(`文件已上传到本地: ${uniqueFilename}`);
      return result;
    } catch (error: any) {
      logger.error('本地文件上传失败:', error);
      throw new StorageError('STORAGE_UPLOAD_ERROR', `文件上传失败: ${error.message}`);
    }
  }

  /**
   * 从本地下载文件
   */
  async download(key: string): Promise<Buffer> {
    try {
      const filePath = path.join(this.uploadDir, key);
      
      if (!fs.existsSync(filePath)) {
        throw new StorageError('STORAGE_FILE_NOT_FOUND', '文件不存在');
      }
      
      return await fs.promises.readFile(filePath);
    } catch (error: any) {
      if (error instanceof StorageError) {
        throw error;
      }
      logger.error('本地文件下载失败:', error);
      throw new StorageError('STORAGE_DOWNLOAD_ERROR', `文件下载失败: ${error.message}`);
    }
  }

  /**
   * 删除本地文件
   */
  async delete(key: string): Promise<boolean> {
    try {
      const filePath = path.join(this.uploadDir, key);
      
      if (!fs.existsSync(filePath)) {
        return false;
      }
      
      await fs.promises.unlink(filePath);
      logger.info(`本地文件已删除: ${key}`);
      return true;
    } catch (error: any) {
      logger.error('本地文件删除失败:', error);
      throw new StorageError('STORAGE_DELETE_ERROR', `文件删除失败: ${error.message}`);
    }
  }

  /**
   * 获取文件 URL
   */
  getUrl(key: string): string {
    return `${this.baseUrl}/uploads/${key}`;
  }
}

/**
 * S3 兼容存储服务实现
 */
export class S3StorageService implements IStorageService {
  private s3Client: S3Client;
  private bucket: string;
  private publicUrl: string;
  private provider: S3Provider;

  constructor(config: IS3StorageConfig) {
    this.bucket = config.bucket;
    this.publicUrl = config.publicUrl || '';
    this.provider = config.provider;
    
    // 根据服务商配置 S3 客户端
    const s3Config: any = {
      region: config.region,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    };
    
    // 设置端点（非 AWS 服务商需要）
    if (config.endpoint) {
      s3Config.endpoint = config.endpoint;
      s3Config.forcePathStyle = config.provider !== S3Provider.AWS;
    }
    
    this.s3Client = new S3Client(s3Config);
    logger.info(`S3 存储服务已初始化: ${config.provider}`);
  }

  /**
   * 上传文件到 S3
   */
  async upload(file: Buffer, filename: string, mimetype: string): Promise<StorageResult> {
    try {
      // 生成唯一文件名
      const ext = path.extname(filename);
      const uniqueKey = `${Date.now()}-${Math.floor(Math.random() * 1000000000)}${ext}`;
      
      const command = new PutObjectCommand({
        Bucket: this.bucket,
        Key: uniqueKey,
        Body: file,
        ContentType: mimetype,
      });
      
      await this.s3Client.send(command);
      
      const result: StorageResult = {
        key: uniqueKey,
        url: this.getUrl(uniqueKey),
        size: file.length,
      };
      
      logger.info(`文件已上传到 S3: ${uniqueKey}`);
      return result;
    } catch (error: any) {
      logger.error('S3 文件上传失败:', error);
      throw new StorageError('STORAGE_UPLOAD_ERROR', `S3 文件上传失败: ${error.message}`);
    }
  }

  /**
   * 从 S3 下载文件
   */
  async download(key: string): Promise<Buffer> {
    try {
      const command = new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
      });
      
      const response = await this.s3Client.send(command);
      
      if (!response.Body) {
        throw new StorageError('STORAGE_FILE_NOT_FOUND', '文件不存在');
      }
      
      // 将流转换为 Buffer
      const stream = response.Body as Readable;
      const chunks: Buffer[] = [];
      
      for await (const chunk of stream) {
        chunks.push(Buffer.from(chunk));
      }
      
      return Buffer.concat(chunks);
    } catch (error: any) {
      if (error instanceof StorageError) {
        throw error;
      }
      if (error.name === 'NoSuchKey') {
        throw new StorageError('STORAGE_FILE_NOT_FOUND', '文件不存在');
      }
      logger.error('S3 文件下载失败:', error);
      throw new StorageError('STORAGE_DOWNLOAD_ERROR', `S3 文件下载失败: ${error.message}`);
    }
  }

  /**
   * 删除 S3 文件
   */
  async delete(key: string): Promise<boolean> {
    try {
      const command = new DeleteObjectCommand({
        Bucket: this.bucket,
        Key: key,
      });
      
      await this.s3Client.send(command);
      logger.info(`S3 文件已删除: ${key}`);
      return true;
    } catch (error: any) {
      logger.error('S3 文件删除失败:', error);
      throw new StorageError('STORAGE_DELETE_ERROR', `S3 文件删除失败: ${error.message}`);
    }
  }

  /**
   * 获取文件 URL
   */
  getUrl(key: string): string {
    if (this.publicUrl) {
      return `${this.publicUrl}/${key}`;
    }
    
    // 根据服务商生成默认 URL
    switch (this.provider) {
      case S3Provider.ALIYUN:
        return `https://${this.bucket}.oss-${this.s3Client.config.region}.aliyuncs.com/${key}`;
      case S3Provider.TENCENT:
        return `https://${this.bucket}.cos.${this.s3Client.config.region}.myqcloud.com/${key}`;
      case S3Provider.AWS:
      default:
        return `https://${this.bucket}.s3.${this.s3Client.config.region}.amazonaws.com/${key}`;
    }
  }
}

/**
 * 存储服务工厂
 */
export class StorageServiceFactory {
  private static instance: IStorageService | null = null;
  private static currentConfig: IStorageConfig | null = null;

  /**
   * 创建存储服务实例
   */
  static create(config: IStorageConfig, baseUrl: string = 'http://10.42.0.1:3000'): IStorageService {
    switch (config.type) {
      case StorageType.S3:
        if (!config.s3) {
          throw new StorageError('STORAGE_CONFIG_INVALID', 'S3 配置不能为空');
        }
        return new S3StorageService(config.s3);
        
      case StorageType.LOCAL:
      default:
        const uploadDir = config.local?.uploadDir || 'uploads';
        return new LocalStorageService(uploadDir, baseUrl);
    }
  }

  /**
   * 获取存储服务实例（单例模式，自动从配置加载）
   */
  static async getInstance(): Promise<IStorageService> {
    try {
      const systemConfig = await ConfigService.getConfig();
      const storageConfig = systemConfig.storage;
      
      // 检查配置是否变化
      const configChanged = !this.currentConfig || 
        JSON.stringify(this.currentConfig) !== JSON.stringify(storageConfig);
      
      if (!this.instance || configChanged) {
        this.instance = this.create(storageConfig, systemConfig.baseUrl);
        this.currentConfig = storageConfig;
        logger.info(`存储服务已初始化: ${storageConfig.type}`);
      }
      
      return this.instance;
    } catch (error: any) {
      logger.error('获取存储服务实例失败:', error);
      // 返回默认本地存储
      if (!this.instance) {
        this.instance = new LocalStorageService();
      }
      return this.instance;
    }
  }

  /**
   * 重置实例（配置变更时调用）
   */
  static resetInstance(): void {
    this.instance = null;
    this.currentConfig = null;
  }

  /**
   * 测试存储连接
   */
  static async testConnection(config: IStorageConfig, baseUrl: string = 'http://10.42.0.1:3000'): Promise<{ success: boolean; message: string }> {
    try {
      const service = this.create(config, baseUrl);
      
      // 创建测试文件
      const testContent = Buffer.from('test');
      const testFilename = `test-${Date.now()}.txt`;
      
      // 上传测试
      const result = await service.upload(testContent, testFilename, 'text/plain');
      
      // 删除测试文件
      await service.delete(result.key);
      
      return {
        success: true,
        message: '存储连接测试成功',
      };
    } catch (error: any) {
      return {
        success: false,
        message: `存储连接测试失败: ${error.message}`,
      };
    }
  }
}

export default StorageServiceFactory;
