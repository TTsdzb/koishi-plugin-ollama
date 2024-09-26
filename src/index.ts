import { Context, h, Logger, Schema, Service } from "koishi";
import { Message, Ollama } from "ollama";

class OllamaService extends Service {
  chatContexts: Map<string, Message[]> = new Map();

  public api: Ollama;

  constructor(ctx: Context, config: OllamaService.Config) {
    super(ctx, "ollama");
    ctx.i18n.define("zh-CN", require("./locales/zh-CN"));

    const logger = new Logger("ollama");
    logger.debug("Config:", config);

    this.api = new Ollama({ host: config.endpoint });

    if (config.enableChat) {
      ctx
        .command("resetChat")
        .option("user", "-u [target:user]", { authority: 3 })
        .action(({ session, options }) => {
          const target = options.user
            ? options.user
            : session.guildId
            ? session.gid
            : session.uid;
          logger.debug("Trying to reset for:", target);

          this.chatContexts.delete(target);
          return session.i18n(
            options.user ? ".successWithTarget" : ".success",
            [target]
          );
        });

      ctx.middleware(async (session, next) => {
        const at = h.select(session.elements, "at")[0];
        if (session.guildId && (!at || at.attrs.id !== session.bot.userId))
          return next();

        const source = session.guildId ? session.gid : session.uid;

        const content =
          (session.guildId ? `${session.username}：` : "") +
          h.transform(session.content, { at: false, quote: false }).trim();
        logger.debug(`Message from ${source}:`, content);

        if (content.length > config.tooLongThreshold)
          return session.i18n("ollama-chat.messages.contentTooLong");

        if (!this.chatContexts.has(source)) this.chatContexts.set(source, []);
        const chatContext = this.chatContexts.get(source);
        logger.debug(`History context for ${source}:`, chatContext);

        chatContext.push({ role: "user", content });
        try {
          const res = await this.api.chat({
            model: config.chatModelName,
            messages: chatContext,
            stream: false,
          });
          chatContext.push(res.message);
          return h("quote", { id: session.messageId }) + res.message.content;
        } catch (e) {
          chatContext.pop();

          if (e.cause?.code === "UND_ERR_CONNECT_TIMEOUT")
            return session.i18n("ollama-chat.messages.connTimeout");
          if (e.cause?.code === "ECONNREFUSED")
            return session.i18n("ollama-chat.messages.connRefused");

          logger.error("Unknown error when chat:");
          logger.error(e);
          console.log(e);
          return session.i18n("ollama-chat.messages.unknownError");
        }
      });
    }
  }
}

namespace OllamaService {
  export const Config: Schema<Config> = Schema.intersect([
    Schema.object({
      endpoint: Schema.string().default("http://localhost:11434"),
      enableChat: Schema.boolean().default(false),
    }),
    Schema.union([
      Schema.object({
        enableChat: Schema.const(true).required(),
        tooLongThreshold: Schema.number().default(100),
        chatModelName: Schema.string().required(),
      }),
      Schema.object({}),
    ]),
  ]).i18n({
    "zh-CN": require("./locales/zh-CN")._config,
  }) as Schema<Config>;

  export interface Config {
    endpoint: string;
    enableChat: boolean;
    tooLongThreshold: number;
    chatModelName: string;
  }
}

export default OllamaService;

declare module "koishi" {
  interface Context {
    ollama: OllamaService;
  }
}
