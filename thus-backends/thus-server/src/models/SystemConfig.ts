import mongoose, { Schema, Document, Model, Types } from 'mongoose';

/**
 * 存储类型
 */
export enum StorageType {
  LOCAL = 'local',
  S3 = 's3',
}

/**
 * S3 服务商类型
 */
export enum S3Provider {
  AWS = 'aws',
  ALIYUN = 'aliyun',
  TENCENT = 'tencent',
  CUSTOM = 'custom',
}

/**
 * 短信服务商类型
 */
export enum SMSProvider {
  TENCENT = 'tencent',
  ALIYUN = 'aliyun',
  YUNPIAN = 'yunpian',
}

/**
 * 本地存储配置接口
 */
export interface ILocalStorageConfig {
  uploadDir: string;
}

/**
 * S3 存储配置接口
 */
export interface IS3StorageConfig {
  provider: S3Provider;
  endpoint: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  region: string;
  publicUrl?: string;
}

/**
 * 存储配置接口
 */
export interface IStorageConfig {
  type: StorageType;
  local?: ILocalStorageConfig;
  s3?: IS3StorageConfig;
}

/**
 * 腾讯云短信配置
 */
export interface ITencentSMSConfig {
  secretId: string;
  secretKey: string;
  appId: string;
  signName: string;
  templateId: string;
  region: string;
}

/**
 * 阿里云短信配置
 */
export interface IAliyunSMSConfig {
  accessKeyId: string;
  accessKeySecret: string;
  signName: string;
  templateCode: string;
}

/**
 * 云片短信配置
 */
export interface IYunpianSMSConfig {
  apiKey: string;
  templateId: string;
}

/**
 * 短信配置接口
 */
export interface ISMSConfig {
  enabled: boolean;
  provider: SMSProvider;
  tencent?: ITencentSMSConfig;
  aliyun?: IAliyunSMSConfig;
  yunpian?: IYunpianSMSConfig;
}

/**
 * 邮箱配置接口
 */
export interface IEmailConfig {
  enabled: boolean;
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  from: string;
}

/**
 * 微信配置接口
 */
export interface IWeChatConfig {
  enabled: boolean;
  gzhAppId: string;
  gzhAppSecret: string;
  miniAppId?: string;
  miniAppSecret?: string;
}

/**
 * 政策内容接口
 */
export interface IPolicyContent {
  content: string;
  version: string;
  lastUpdated: Date;
}

/**
 * 政策配置接口
 */
export interface IPoliciesConfig {
  terms: IPolicyContent;
  privacy: IPolicyContent;
}

/**
 * AI提供商配置接口
 */
export interface IAIProviderConfig {
  enabled: boolean;
  name: string;
  baseUrl: string;
  apiKey: string;
  defaultModel: string;
  models: string[];
}

/**
 * AI功能配置接口
 */
export interface IAIConfig {
  enabled: boolean;
  autoTag: boolean;
  autoSummary: boolean;
  similarRecommend: boolean;
  providers: IAIProviderConfig[];
}

/**
 * 系统配置接口
 */
export interface ISystemConfig extends Document {
  _id: Types.ObjectId;
  
  baseUrl: string;
  frontendUrl: string;
  
  proxy?: {
    enabled: boolean;
    host?: string;
    port?: number;
  };
  
  storage: IStorageConfig;
  sms: ISMSConfig;
  email: IEmailConfig;
  wechat: IWeChatConfig;
  policies: IPoliciesConfig;
  ai: IAIConfig;
  
  updatedAt: Date;
  updatedBy?: Types.ObjectId;
}

/**
 * 本地存储配置 Schema
 */
const LocalStorageConfigSchema = new Schema<ILocalStorageConfig>(
  {
    uploadDir: {
      type: String,
      default: 'uploads',
    },
  },
  { _id: false }
);

/**
 * S3 存储配置 Schema
 */
const S3StorageConfigSchema = new Schema<IS3StorageConfig>(
  {
    provider: {
      type: String,
      enum: Object.values(S3Provider),
      default: S3Provider.AWS,
    },
    endpoint: {
      type: String,
      default: '',
    },
    accessKeyId: {
      type: String,
      default: '',
    },
    secretAccessKey: {
      type: String,
      default: '',
    },
    bucket: {
      type: String,
      default: '',
    },
    region: {
      type: String,
      default: '',
    },
    publicUrl: {
      type: String,
      default: '',
    },
  },
  { _id: false }
);

/**
 * 存储配置 Schema
 */
const StorageConfigSchema = new Schema<IStorageConfig>(
  {
    type: {
      type: String,
      enum: Object.values(StorageType),
      default: StorageType.LOCAL,
    },
    local: {
      type: LocalStorageConfigSchema,
      default: () => ({ uploadDir: 'uploads' }),
    },
    s3: {
      type: S3StorageConfigSchema,
      default: () => ({}),
    },
  },
  { _id: false }
);

/**
 * 腾讯云短信配置 Schema
 */
const TencentSMSConfigSchema = new Schema<ITencentSMSConfig>(
  {
    secretId: { type: String, default: '' },
    secretKey: { type: String, default: '' },
    appId: { type: String, default: '' },
    signName: { type: String, default: '' },
    templateId: { type: String, default: '' },
    region: { type: String, default: 'ap-guangzhou' },
  },
  { _id: false }
);

/**
 * 阿里云短信配置 Schema
 */
const AliyunSMSConfigSchema = new Schema<IAliyunSMSConfig>(
  {
    accessKeyId: { type: String, default: '' },
    accessKeySecret: { type: String, default: '' },
    signName: { type: String, default: '' },
    templateCode: { type: String, default: '' },
  },
  { _id: false }
);

/**
 * 云片短信配置 Schema
 */
const YunpianSMSConfigSchema = new Schema<IYunpianSMSConfig>(
  {
    apiKey: { type: String, default: '' },
    templateId: { type: String, default: '' },
  },
  { _id: false }
);

/**
 * 短信配置 Schema
 */
const SMSConfigSchema = new Schema<ISMSConfig>(
  {
    enabled: { type: Boolean, default: false },
    provider: {
      type: String,
      enum: Object.values(SMSProvider),
      default: SMSProvider.TENCENT,
    },
    tencent: { type: TencentSMSConfigSchema, default: () => ({}) },
    aliyun: { type: AliyunSMSConfigSchema, default: () => ({}) },
    yunpian: { type: YunpianSMSConfigSchema, default: () => ({}) },
  },
  { _id: false }
);

/**
 * 微信配置 Schema
 */
const WeChatConfigSchema = new Schema<IWeChatConfig>(
  {
    enabled: { type: Boolean, default: false },
    gzhAppId: { type: String, default: '' },
    gzhAppSecret: { type: String, default: '' },
    miniAppId: { type: String, default: '' },
    miniAppSecret: { type: String, default: '' },
  },
  { _id: false }
);

/**
 * 政策内容 Schema
 */
const PolicyContentSchema = new Schema<IPolicyContent>(
  {
    content: { type: String, default: '' },
    version: { type: String, default: '1.0.0' },
    lastUpdated: { type: Date, default: Date.now },
  },
  { _id: false }
);

/**
 * 政策配置 Schema
 */
const PoliciesConfigSchema = new Schema<IPoliciesConfig>(
  {
    terms: {
      type: PolicyContentSchema,
      default: () => ({
        content: getDefaultTermsContent(),
        version: '1.0.0',
        lastUpdated: new Date(),
      }),
    },
    privacy: {
      type: PolicyContentSchema,
      default: () => ({
        content: getDefaultPrivacyContent(),
        version: '1.0.0',
        lastUpdated: new Date(),
      }),
    },
  },
  { _id: false }
);

/**
 * 系统配置 Schema
 */
const SystemConfigSchema = new Schema<ISystemConfig>(
  {
    baseUrl: {
      type: String,
      default: 'http://localhost:3000',
    },
    frontendUrl: {
      type: String,
      default: 'http://localhost:5175',
    },
    proxy: {
      enabled: { type: Boolean, default: false },
      host: { type: String, default: '' },
      port: { type: Number, default: 0 },
    },
    storage: {
      type: StorageConfigSchema,
      default: () => ({
        type: StorageType.LOCAL,
        local: { uploadDir: 'uploads' },
      }),
    },
    sms: {
      type: SMSConfigSchema,
      default: () => ({
        enabled: false,
        provider: SMSProvider.TENCENT,
      }),
    },
    email: {
      enabled: { type: Boolean, default: false },
      host: { type: String, default: '' },
      port: { type: Number, default: 587 },
      secure: { type: Boolean, default: false },
      user: { type: String, default: '' },
      pass: { type: String, default: '' },
      from: { type: String, default: '' },
    },
    wechat: {
      type: WeChatConfigSchema,
      default: () => ({
        enabled: false,
      }),
    },
    policies: {
      type: PoliciesConfigSchema,
      default: () => ({}),
    },
    ai: {
      enabled: { type: Boolean, default: true },
      autoTag: { type: Boolean, default: true },
      autoSummary: { type: Boolean, default: true },
      similarRecommend: { type: Boolean, default: true },
      providers: {
        type: [{
          enabled: { type: Boolean, default: true },
          name: { type: String, required: true },
          baseUrl: { type: String, required: true },
          apiKey: { type: String, required: true },
          defaultModel: { type: String, required: true },
          models: { type: [String], default: [] },
        }],
        default: () => {
          // 只有在有有效 API key 时才创建默认 provider
          const apiKey = process.env.OPENAI_API_KEY;
          if (!apiKey) return [];
          return [{
            enabled: true,
            name: 'openai',
            baseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
            apiKey: apiKey,
            defaultModel: process.env.OPENAI_DEFAULT_MODEL || 'gpt-3.5-turbo',
            models: [process.env.OPENAI_DEFAULT_MODEL || 'gpt-3.5-turbo'],
          }];
        },
      },
    },
    updatedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
    },
  },
  {
    timestamps: true,
    collection: 'system_configs',
  }
);

/**
 * 获取默认服务协议内容
 */
function getDefaultTermsContent(): string {
  return `
<h2 id="section-1">1. 服务条款概述</h2>
<p>欢迎使用我们的服务。本服务条款（以下简称"条款"）规定了您使用我们平台的条件和规则。</p>

<h2 id="section-2">2. 账户注册与安全</h2>
<p>2.1 您需要注册账户才能使用我们的完整服务。</p>
<p>2.2 您有责任保护您的账户安全，包括密码的保密性。</p>
<p>2.3 如发现任何未经授权使用您账户的情况，请立即通知我们。</p>

<h2 id="section-3">3. 用户行为规范</h2>
<p>3.1 您同意不会使用本服务进行任何违法活动。</p>
<p>3.2 您同意不会上传或分享任何侵犯他人权利的内容。</p>
<p>3.3 您同意遵守所有适用的法律法规。</p>

<h2 id="section-4">4. 知识产权</h2>
<p>4.1 本平台的所有内容、设计和技术均受知识产权法保护。</p>
<p>4.2 您上传的内容仍归您所有，但您授予我们使用这些内容的许可。</p>

<h2 id="section-5">5. 服务变更与终止</h2>
<p>5.1 我们保留随时修改或终止服务的权利。</p>
<p>5.2 重大变更将提前通知用户。</p>

<h2 id="section-6">6. 免责声明</h2>
<p>6.1 本服务按"现状"提供，不提供任何明示或暗示的保证。</p>
<p>6.2 我们不对因使用本服务而产生的任何损失承担责任。</p>

<h2 id="section-7">7. 联系我们</h2>
<p>如有任何问题，请通过平台内的联系方式与我们取得联系。</p>
  `.trim();
}

/**
 * 获取默认隐私政策内容
 */
function getDefaultPrivacyContent(): string {
  return `
<h2 id="section-1">1. 信息收集</h2>
<p>1.1 我们收集您在注册和使用服务时提供的个人信息，包括但不限于：</p>
<ul>
  <li>账户信息（用户名、邮箱、手机号）</li>
  <li>个人资料（头像、昵称）</li>
  <li>使用数据（登录时间、操作记录）</li>
</ul>

<h2 id="section-2">2. 信息使用</h2>
<p>2.1 我们使用收集的信息用于：</p>
<ul>
  <li>提供和改进我们的服务</li>
  <li>与您沟通，包括发送服务通知</li>
  <li>保护我们的服务和用户安全</li>
</ul>

<h2 id="section-3">3. 信息共享</h2>
<p>3.1 我们不会出售您的个人信息。</p>
<p>3.2 我们可能在以下情况下共享您的信息：</p>
<ul>
  <li>经您同意</li>
  <li>法律要求</li>
  <li>保护我们的权利和财产</li>
</ul>

<h2 id="section-4">4. 数据安全</h2>
<p>4.1 我们采取适当的技术和组织措施保护您的个人信息。</p>
<p>4.2 我们使用加密技术保护敏感数据的传输和存储。</p>

<h2 id="section-5">5. Cookie 使用</h2>
<p>5.1 我们使用 Cookie 和类似技术来改善用户体验。</p>
<p>5.2 您可以通过浏览器设置管理 Cookie 偏好。</p>

<h2 id="section-6">6. 您的权利</h2>
<p>6.1 您有权访问、更正或删除您的个人信息。</p>
<p>6.2 您可以随时注销您的账户。</p>

<h2 id="section-7">7. 政策更新</h2>
<p>7.1 我们可能会不时更新本隐私政策。</p>
<p>7.2 重大变更将通过平台通知您。</p>

<h2 id="section-8">8. 联系我们</h2>
<p>如有任何隐私相关问题，请通过平台内的联系方式与我们取得联系。</p>
  `.trim();
}

/**
 * 获取或创建系统配置（单例模式）
 */
SystemConfigSchema.statics.getConfig = async function (): Promise<ISystemConfig> {
  let config = await this.findOne();
  if (!config) {
    config = await this.create({});
  }
  return config;
};

/**
 * 更新系统配置
 */
SystemConfigSchema.statics.updateConfig = async function (
  updates: Partial<ISystemConfig>,
  updatedBy?: Types.ObjectId
): Promise<ISystemConfig> {
  let config = await this.findOne();
  if (!config) {
    config = new this({});
  }
  
  // 更新字段
  Object.assign(config, updates);
  if (updatedBy) {
    config.updatedBy = updatedBy;
  }
  
  await config.save();
  return config;
};

// 添加静态方法类型
interface ISystemConfigModel extends Model<ISystemConfig> {
  getConfig(): Promise<ISystemConfig>;
  updateConfig(updates: Partial<ISystemConfig>, updatedBy?: Types.ObjectId): Promise<ISystemConfig>;
}

/**
 * SystemConfig 模型
 */
const SystemConfig = (mongoose.models.SystemConfig ||
  mongoose.model<ISystemConfig, ISystemConfigModel>('SystemConfig', SystemConfigSchema)) as ISystemConfigModel;

export default SystemConfig;
