# uni-pretty-url

[![npm version](https://img.shields.io/npm/v/uni-pretty-url)](https://www.npmjs.com/package/uni-pretty-url)
[![CI](https://github.com/hughcube/uni-pretty-url/actions/workflows/ci.yml/badge.svg)](https://github.com/hughcube/uni-pretty-url/actions/workflows/ci.yml)
[![license](https://img.shields.io/npm/l/uni-pretty-url)](./LICENSE)

让你的 uni-app（Vue 3 + Vite）H5 应用拥有干净的 URL —— 自动去掉 `/pages/` 前缀，还能把 `?id=123` 变成 `/123`。

**不需要改一行业务代码。** 你继续写 `/pages/` 路径，地址栏自动变干净。小程序和 App 端完全不受影响。

---

## 目录

- [它能做什么](#它能做什么)
- [安装](#安装)
- [最简用法（3 步）](#最简用法3-步)
- [配置别名](#配置别名)
- [完整配置参考](#完整配置参考)
- [接入已有项目](#接入已有项目)
- [常见问题](#常见问题)
- [API 参考](#api-参考)
- [原理简述](#原理简述)
- [许可](#许可)

---

## 它能做什么

假设你的 uni-app 项目有这些页面：

```
pages/
  index/index.vue        → 首页
  course/detail.vue      → 课程详情
  user/profile.vue       → 用户主页
```

**不用本插件时**，用户在浏览器地址栏看到的是：

```
https://example.com/pages/index/index
https://example.com/pages/course/detail?id=123
https://example.com/pages/user/profile?name=alice
```

**用了本插件后**，地址栏变成：

```
https://example.com/
https://example.com/topics/123
https://example.com/u/alice
```

业务代码里你继续写 `uni.navigateTo({ url: '/pages/course/detail?id=123' })`，地址栏自动显示 `/topics/123`。用户刷新页面、点前进/后退，一切正常。

---

## 安装

```bash
npm install uni-pretty-url
# 或者
pnpm add uni-pretty-url
```

需要 `vue-router >= 4.4.0`。如果你用的是 uni-app + Vite，项目里已经有 vue-router 了。

---

## 最简用法（3 步）

### 第 1 步：确保是 history 模式

打开 `src/manifest.json`，确认：

```json
{
  "h5": {
    "router": {
      "mode": "history"
    }
  }
}
```

> 必须是 `"history"`，不能用 `"hash"`。hash 模式不支持。

### 第 2 步：加插件

打开 `vite.config.ts`，把 `uniPrettyUrl(...)` **放在 `uni()` 前面**：

```ts
// vite.config.ts
import { defineConfig } from 'vite'
import uni from '@dcloudio/vite-plugin-uni'
import { uniPrettyUrl } from 'uni-pretty-url/vite'

export default defineConfig({
  plugins: [
    // 1. 先注册 uni-pretty-url
    uniPrettyUrl(),
    // 2. 再注册 uni
    uni(),
  ],
})
```

### 第 3 步：启动

```bash
npm run dev:h5
```

打开浏览器，地址栏里的 `/pages/` 没了。原来 `http://localhost:5173/pages/index/index` 现在变成 `http://localhost:5173/index/index`。

**就这三步**，全站的 `/pages/` 前缀都消失了。

---

## 配置别名

如果只是去掉 `/pages/`，上面的配置就够了。如果你想把 `/pages/course/detail?id=123` 变成 `/topics/123`，需要配置 `aliases`。

### 例 1：首页映射到根路径

```ts
uniPrettyUrl({
  aliases: [
    {
      real: '/pages/index/index',   // 页面的真实路径
      pretty: '/',                   // 对外显示为 /
    },
  ],
})
```

效果：访问首页时地址栏显示 `https://example.com/`。

### 例 2：把 query 参数变成路径参数

```ts
uniPrettyUrl({
  aliases: [
    {
      real: '/pages/course/detail',
      pretty: '/topics/:id(\\d+)',   // :id 只匹配数字
      params: {
        id: 'query.id',               // 把 query 里的 id 映射到路径参数 :id
      },
    },
  ],
})
```

效果：

| 访问的 URL | 地址栏显示 |
|---|---|
| `/pages/course/detail?id=123` | `/topics/123` |
| `/pages/course/detail?id=42&tab=comments` | `/topics/42?tab=comments` |
| `/pages/course/detail`（没传 id） | 报错：missing required query param "id" |

### 例 3：多条规则

```ts
uniPrettyUrl({
  pagesPrefix: 'pages',
  aliases: [
    { real: '/pages/index/index', pretty: '/' },
    { real: '/pages/about/about', pretty: '/about' },
    { real: '/pages/course/detail', pretty: '/topics/:id(\\d+)', params: { id: 'query.id' } },
    { real: '/pages/user/profile', pretty: '/u/:username', params: { username: 'query.name' } },
  ],
})
```

### 例 4：某些路径不删前缀

```ts
uniPrettyUrl({
  strip: {
    excludePrefixes: ['/special'],
  },
})
```

效果：`/pages/special/admin` 保持原样，不删 `/pages/`。其他路径正常删除。

### pretty 路径的参数写法

`pretty` 字段支持两个语法：

| 写法 | 含义 | 示例 |
|---|---|---|
| `:name` | 匹配任意字符（`/` 除外） | `/topics/:id` 匹配 `/topics/abc` |
| `:name(正则)` | 按正则匹配 | `/topics/:id(\\d+)` 只匹配数字 |

`params` 字段的值目前只支持 `"query.参数名"`，表示从 URL query 的指定参数中取值。

---

## 完整配置参考

```ts
interface UniPrettyUrlOptions {
  /**
   * 页面在 pages/ 目录下的前缀名
   * @default "pages"
   */
  pagesPrefix?: string

  /**
   * 别名规则列表
   * @default []
   */
  aliases?: Array<{
    /** uni-app 页面真实路径，如 "/pages/course/detail" */
    real: string
    /** 对外展示的美化路径，如 "/topics/:id(\\d+)" */
    pretty: string
    /**
     * 路径参数来源映射
     * key: pretty 里的参数名（如 id）
     * value: 来源表达式，目前只支持 "query.参数名"
     */
    params?: Record<string, string>
  }>

  /**
   * 前缀剥离选项
   */
  strip?: {
    /**
     * 不剥离 /pages/ 的路径前缀列表
     * 例如 ["/special"] 会让 /pages/special/* 保持原样
     */
    excludePrefixes?: string[]
  }
}
```

---

## 接入已有项目

如果你的项目本来就有 `uni-simple-router` 或自行处理了 URL 美化：

1. **先移除旧方案**。本插件通过虚拟模块拦截 `vue-router`，如果其他插件也拦截 `vue-router`，可能冲突。
2. **小程序/App 端完全不用管**。非 H5 构建时插件自动跳过。
3. **`<router-link>` 和 `router.push` 都照旧**。如果你页面里写了 `router.push('/pages/xxx')`，不用改。
4. **所有页面跳转都写真实路径**（`/pages/` 开头的），不要写美化路径。美化路径只出现在地址栏里。

---

## 常见问题

### Q: 启动后地址栏还是带 `/pages/`？

检查：
1. `manifest.json` 里 `h5.router.mode` 是不是 `"history"`（不能是 `"hash"`）
2. `uniPrettyUrl()` 是不是放在 `uni()` **前面**（顺序很重要）
3. 是不是在浏览器直接打开 `/pages/xxx`？试试从首页正常跳转过去

### Q: 刷新后页面白屏？

可能是 alias 配置的 `real` 路径和你 `pages.json` 里的不一致。`real` 必须精确匹配 `pages.json` 中的路径。

### Q: hash 模式真的不能用吗？

对，hash 模式（URL 带 `#`）不支持。hash 模式下 vue-router 不读 pathname，无法做 URL 翻译。

### Q: 兼容哪些 uni-app 版本？

uni-app Vue 3 + Vite 版本（`@dcloudio/uni-app` 3.x），需要 `vue-router` 4.x。Vue 2 版本不支持。

### Q: 需要申请 `uni-simple-router` 的许可吗？

不需要。本项目和 uni-simple-router 没有关系，是独立实现。

---

## API 参考

本包提供三个入口：

### `uni-pretty-url/vite`

Vite 插件，这是你唯一需要在配置文件中引入的。

```ts
import { uniPrettyUrl } from 'uni-pretty-url/vite'
```

### `uni-pretty-url/core`

核心 URL 翻译函数。

```ts
import { toPretty, toReal, compile, match, generate } from 'uni-pretty-url/core'

// toPretty: 真实路径 → 美化路径
toPretty('/pages/course/detail?id=42', config)
// → '/topics/42'

// toReal: 美化路径 → 真实路径
toReal('/topics/42', config)
// → '/pages/course/detail?id=42'

// compile / match / generate: 底层路径模式工具
const p = compile('/topics/:id(\\d+)')
match(p, '/topics/42')   // → { id: '42' }
generate(p, { id: '42' }) // → '/topics/42'
```

### `uni-pretty-url/runtime`

手动包装 RouterHistory 实例，一般不需要直接用，Vite 插件已经自动处理了。

```ts
import { createPrettyHistory } from 'uni-pretty-url/runtime'
```

---

## 原理简述

本插件通过 Vite 的 `resolve.alias`，拦截 uni-app 内部对 `vue-router` 的导入，将其 `createWebHistory` 替换为一个包装版本。

包装版本做的事情很简单——在所有 URL 出入点做翻译：

| 操作 | 翻译方向 |
|---|---|
| `history.push(url)` | 真实路径 → 美化路径（写入地址栏） |
| `history.replace(url)` | 真实路径 → 美化路径 |
| `history.location` | 美化路径 → 真实路径（读取地址栏） |
| `history.listen(fn)` | 回调参数中的路径做美化→真实转换 |
| `history.createHref(url)` | 真实路径 → 美化路径 |

整个过程不到 80 行代码（`src/vite/index.ts` 中的 `generateWrapperModule`）。不猴补丁任何 uni-app 内部 API，不触碰 `uni.navigateTo` 等导航方法。

---

## 许可

MIT
