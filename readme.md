# koishi-plugin-ollama

[![npm](https://img.shields.io/npm/v/koishi-plugin-ollama?style=flat-square)](https://www.npmjs.com/package/koishi-plugin-ollama)

适用于 Koishi 的 Ollama 插件，提供 Ollama API 接入服务与基本的聊天功能（可选，默认不开启）。

在使用本插件之前请确保自己已经配置好且会使用 [Ollama](https://ollama.com)。

服务 API 参考[官方说明](https://github.com/ollama/ollama-js?tab=readme-ov-file#usage)。可在 `ctx.ollama.api` 调用。例：

```ts
const response = await ctx.ollama.api.chat({
  model: 'llama3.1',
  messages: [{ role: 'user', content: 'Why is the sky blue?' }],
});
return response.message.content;
```
