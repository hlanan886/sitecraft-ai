/**
 * capture 的类型定义。
 *
 * 单独一个文件是为了让**消费方不必 import Playwright 那侧**：
 * `site-capture.ts`（纯逻辑）与 `site-capture-browser.ts`（重依赖）都只依赖这里。
 */

/** 抓到的资源。 */
export type SiteCaptureAsset = {
  /** 绝对 URL（已按 `document.baseURI` 解析，相对路径不会漏） */
  url: string;
  kind: "image" | "stylesheet" | "script" | "font" | "video" | "other";
  /**
   * 在页面里的真实位置——**来自 `getBoundingClientRect()`，不是估的**。
   *
   * 这是后续裁图的唯一可信坐标来源。实测教训：按百分比等分猜坐标，
   * 每张"产品图"会塞进两三个产品（页面栅格有间距、元素大小不一）。
   *
   * `null` = 该资源不参与布局（如 CSS 里引用的字体），无法定位。
   */
  box: { x: number; y: number; width: number; height: number } | null;
  /** 图片的自然尺寸（`naturalWidth/Height`）；非图片为 null */
  natural: { width: number; height: number } | null;
  /** 小图标/装饰图——**不丢弃**，只在挑图时降低优先级 */
  decorative: boolean;
  /** 下载后的字节数（未下载时为 undefined） */
  bytes?: number;
  /** 下载失败的原因（成功时为 undefined） */
  error?: string;
};

/** 整页截图。 */
export type SiteCaptureShot = {
  /** 文件路径（相对仓库根） */
  file: string;
  width: number;
  height: number;
  bytes: number;
  /** 是否经过缩放（原图超出模型上限时） */
  resized: boolean;
  format: "jpeg" | "png";
  /**
   * 图片内容（与写盘的那份**完全相同**）。
   *
   * 为什么带在返回值里而不是让调用方从 `file` 读回来：
   * ① 少一次磁盘往返；② 更重要的是——`readFile(path.resolve(process.cwd(), 动态路径))`
   * 会让 Turbopack **把整个项目当作要部署的文件追踪进来**
   * （实测警告：`Dynamic filesystem access causes tracing of the whole project`），
   * 拖慢部署甚至撑爆体积上限。直接给 buffer 就没有这个问题。
   */
  body: Buffer;
};

export type SiteCaptureResult = {
  url: string;
  /** 页面标题 */
  title: string;
  /**
   * 渲染后的 HTML（`page.content()`）。
   *
   * **必须用 `page.content()` 而不是 `fetch`**——后者拿到的是服务端原始 HTML，
   * 没有 JS 渲染出来的 DOM，对现代站点等于拿了个空壳。
   */
  html: string;
  assets: SiteCaptureAsset[];
  shot: SiteCaptureShot | null;
  /** 抓取失败的原因（成功时为 null）。**说人话**，不是错误码。 */
  failure: string | null;
  /** 耗时（毫秒），用于成本观察 */
  elapsedMs: number;
  /**
   * 素材沉淀（可选，只有 `collectLibraryAssets` 开启时有）。
   *
   * 与 `assets` 的区别：`assets` 是**这一页引用了什么**，
   * `library` 是**这一页里有什么值得以后再用**——按尺寸筛出来的产品图/主视觉。
   * 两者用途不同，所以不合并：合成一个字段会让"下载哪些"与"沉淀哪些"互相污染。
   */
  library?: LibraryAsset[];
};

/**
 * 值得沉淀的素材。
 *
 * ⚠️ **判据只有尺寸**——不用模型挑。理由：模型判"哪张是产品图"要花 token 且会错，
 * 而尺寸是**我们已经量到的确定事实**（`naturalWidth` 来自浏览器）。
 * 实测一个工业站首页：logo 24–64px、图标 ≤80px、产品图与主视觉 ≥200px——
 * 用尺寸分得开，不必请模型。
 */
export type LibraryAsset = {
  url: string;
  /**
   * 建议的用途分类。
   *
   * `hero` = 面积最大的一张（通常是首屏主视觉）；
   * `product` = 中等尺寸的方形/近方形（产品图多是这个形态）；
   * `wide` = 宽高比明显大于 2 的（横幅/背景）；
   * `other` = 尺寸够大但形态不典型的。
   */
  role: "hero" | "product" | "wide" | "other";
  width: number;
  height: number;
  /** 在页面里的位置（页面坐标），方便日后按"首屏/中部/底部"再挑 */
  box: { x: number; y: number; width: number; height: number } | null;
};

export type CaptureOptions = {
  /** 视口宽（默认 1440）。太窄会让响应式布局退化，抓到的不是桌面版 */
  viewportWidth?: number;
  viewportHeight?: number;
  /** 页面加载后的额外等待（毫秒）。SPA 需要更久 */
  settleMs?: number;
  /** 是否下载资源（A 路径需要；B 路径只要清单和截图，可跳过省时间） */
  downloadAssets?: boolean;
  /**
   * 是否顺带沉淀素材库（默认 false）。
   *
   * 开启后结果里多一个 `library` 字段：按尺寸筛出值得**以后再用**的
   * 产品图/主视觉。与 `downloadAssets` 无关——素材沉淀只读 DOM 里已有的尺寸，
   * 不额外发请求。
   */
  collectLibraryAssets?: boolean;
  /** 截图输出目录（相对仓库根） */
  shotDir: string;
  /** 单次导航超时 */
  timeoutMs?: number;
};
