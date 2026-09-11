/**
 * Настройки gateway — только из окружения. На виртуалке всё задаётся в
 * /opt/stultus/.env (см. deploy/), в репозиторий файл не попадает.
 */
export const config = {
  /** Порт: и WebSocket для плагинов, и MCP для моделей, и проверка здоровья. */
  port: Number(process.env.PORT ?? 8790),

  /**
   * Пропуск для плагинов. Пустой — никто не подключится.
   *
   * Закрыто по умолчанию намеренно: gateway слушает на всю локальную сеть, а
   * через него исполняется произвольный Ruby в SketchUp сотрудников.
   */
  pluginToken: process.env.PLUGIN_TOKEN ?? '',

  /**
   * Адрес, по которому МОДЕЛЬ (процесс Claude Code / Codex на этой же
   * машине) достучится до MCP-эндпоинта gateway. Это всегда localhost:
   * наружу MCP не выставляется.
   */
  mcpBase: process.env.MCP_BASE ?? `http://127.0.0.1:${process.env.PORT ?? 8790}`,

  /**
   * Вход для Claude Agent SDK. `CLAUDE_CODE_OAUTH_TOKEN` — подписка
   * (`claude setup-token`), `ANTHROPIC_API_KEY` — ключ API. Ни того ни
   * другого — провайдер помечается ненастроенным, окно плагина скажет об этом.
   */
  claudeOauthToken: process.env.CLAUDE_CODE_OAUTH_TOKEN ?? '',
  anthropicKey: process.env.ANTHROPIC_API_KEY ?? '',
  /**
   * Считать Claude настроенным без токена в окружении: на машине выполнен
   * `claude login`, и CLI хранит вход сам (на Windows — в хранилище
   * учётных данных, файла .credentials.json нет). Для локальной разработки.
   */
  claudeAssumeLoggedIn: process.env.CLAUDE_ASSUME_LOGGED_IN === '1',
  /**
   * Путь к исполняемому Claude Code вместо встроенного в SDK. Нужен там,
   * где вход выполнен в установленный CLI, а не в SDK-шный бинарник: у них
   * разные хранилища учётных данных, и SDK отвечает «Not logged in».
   */
  claudeCodePath: process.env.CLAUDE_CODE_PATH ?? '',
  claudeModels: (process.env.CLAUDE_MODELS ?? 'claude-opus-5,claude-sonnet-5,claude-haiku-4-5')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  claudeDefaultModel: process.env.CLAUDE_DEFAULT_MODEL ?? 'claude-opus-5',

  /**
   * Вход для Codex. `CODEX_API_KEY` — ключ; либо `codex login` на этой
   * машине (auth.json в CODEX_HOME). Настроенность проверяется по факту:
   * ключ есть или файл auth.json есть.
   */
  codexApiKey: process.env.CODEX_API_KEY ?? '',
  codexHome: process.env.CODEX_HOME ?? `${process.env.HOME ?? process.env.USERPROFILE ?? '.'}/.codex`,
  codexModels: (process.env.CODEX_MODELS ?? 'gpt-5.5,gpt-5.5-codex,gpt-5-codex-mini')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  codexDefaultModel: process.env.CODEX_DEFAULT_MODEL ?? 'gpt-5.5',

  /** Native image generation via Codex login, separate from the chat provider. */
  renderEnabled: process.env.RENDER_ENABLED === '1',
  renderCodexPath: process.env.RENDER_CODEX_PATH ?? '',
  renderModel: process.env.RENDER_MODEL ?? '',
  renderTimeoutMs: Number(process.env.RENDER_TIMEOUT_MS ?? 10 * 60 * 1000),

  /**
   * Потолок кругов «инструмент → ответ» на один ход. Страховка от
   * зацикливания, а не бюджет: цикл «построил → посмотрел → поправил»
   * требует десятков кругов.
   */
  maxTurns: Number(process.env.MAX_TURNS ?? 150),

  /** Сколько ждать ответа плагина на вызов инструмента, мс. execute_ruby на большой модели — минуты. */
  toolTimeoutMs: Number(process.env.TOOL_TIMEOUT_MS ?? 10 * 60 * 1000),

  /** Рабочий каталог для процессов моделей (там же AGENTS.md для Codex). */
  workDir: process.env.WORK_DIR ?? `${process.cwd()}/data/work`,
}
