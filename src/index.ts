import { Context, h, Logger, Schema, Service, Session } from "koishi";
import { Message, Ollama } from "ollama";

interface UserMessage {
  id: string;
  name: string;
  time: string;
  msg: string;
}

abstract class ChatContext {
  public abstract trace(message: UserMessage): void;
  public abstract prepareRequest(): Message[];
  public abstract finishRequest(assistant_message: Message): void;
  public abstract cancelRequest(): void;
}

class PrivateChatContext extends ChatContext {
  tracedMsg: UserMessage;
  history: Message[];

  constructor() {
    super();
    this.tracedMsg = undefined;
    this.history = [];
  }

  public trace(message: UserMessage) {
    this.tracedMsg = message;
  }

  public prepareRequest(): Message[] {
    this.history.push({
      role: "user",
      content: JSON.stringify(this.tracedMsg),
    });
    return this.history;
  }

  public finishRequest(assistant_message: Message) {
    this.history.push(assistant_message);
  }

  public cancelRequest() {
    this.history.pop();
  }
}

class GuildChatContext extends ChatContext {
  tracedMsg: UserMessage[];
  history: Message[];

  constructor() {
    super();
    this.tracedMsg = [];
    this.history = [];
  }

  public trace(message: UserMessage) {
    this.tracedMsg.push(message);
    if (this.tracedMsg.length > 100) this.tracedMsg.splice(0, 1);
  }

  public prepareRequest(): Message[] {
    this.history.push({
      role: "user",
      content: JSON.stringify(this.tracedMsg),
    });
    return this.history;
  }

  public finishRequest(assistant_message: Message) {
    this.tracedMsg = [];
    this.history.push(assistant_message);
  }

  public cancelRequest() {
    this.history.pop();
  }
}

const extractUserMessage = (session: Session): UserMessage => {
  return {
    id: session.userId,
    name: session.username,
    time: new Date(session.timestamp).toString(),
    msg: session.content,
  };
};

class OllamaService extends Service {
  chatContexts: Map<string, ChatContext> = new Map();

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

        const source = session.guildId ? session.gid : session.uid;
        logger.debug(`Message from ${source}:`, session.content);

        if (!this.chatContexts.has(source)) {
          this.chatContexts.set(
            source,
            session.guildId ? new GuildChatContext() : new PrivateChatContext()
          );
        }
        const chatContext = this.chatContexts.get(source);

        const tooLong = session.content.length > config.tooLongThreshold;
        const userMessage = extractUserMessage(session);
        if (!tooLong) chatContext.trace(userMessage);
        if (
          session.guildId &&
          (!at || at.attrs.id !== session.bot.userId) &&
          !session.content.startsWith("@Koishi")
        )
          return next();

        if (tooLong) return session.i18n("ollama-chat.messages.contentTooLong");

        logger.debug(`History context for ${source}:`, chatContext);

        const history = chatContext.prepareRequest();
        try {
          const res = await this.api.chat({
            model: config.chatModelName,
            messages: history,
            stream: false,
          });
          chatContext.finishRequest(res.message);
          return h("quote", { id: session.messageId }) + res.message.content;
        } catch (e) {
          chatContext.cancelRequest();

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
