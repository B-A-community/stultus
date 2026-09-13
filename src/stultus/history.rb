# frozen_string_literal: true
#
# Переписка в файле модели.
#
# Хранится в словаре атрибутов модели под именем DICTIONARY. Правила:
#
#   * один словарь, три ключа — history (JSON-строка), sessions (JSON-строка
#     с идентификаторами сессий провайдеров), version. Чужие словари не
#     трогаем, своих сущностей в модель не добавляем;
#   * потолок HISTORY_LIMIT байт. Старые сообщения отбрасываются с начала:
#     .skp — рабочий файл, и раздувать его перепиской нельзя;
#   * картинки (снимки вьюпорта) в историю не пишутся никогда — только текст
#     и короткие сводки вызовов инструментов. Об этом заботится JS-сторона,
#     здесь — страховка по размеру;
#   * запись идёт прозрачной операцией: отдельного шага Undo «сохранена
#     переписка» пользователь видеть не должен.

require 'json'
require 'time'

module BACommunity
  module Stultus
    module History
      KEY_HISTORY  = 'history'
      KEY_SESSIONS = 'sessions'
      KEY_ARCHIVE  = 'archive'
      KEY_VERSION  = 'version'

      module_function

      def model
        Sketchup.active_model
      end

      # Массив сообщений (уже разобранный JSON). Пусто — [].
      def load
        raw = read(KEY_HISTORY)
        return [] if raw.nil? || raw.empty?
        parsed = JSON.parse(raw)
        parsed.is_a?(Array) ? parsed : []
      rescue JSON::ParserError
        []
      end

      # Принимает массив сообщений, ужимает под лимит, пишет в модель.
      # Возвращает, сколько сообщений реально сохранено.
      def save(messages)
        messages = Array(messages)
        json = JSON.generate(messages)
        while json.bytesize > HISTORY_LIMIT && messages.length > 1
          messages = messages.drop(1)
          json = JSON.generate(messages)
        end
        json = '[]' if json.bytesize > HISTORY_LIMIT
        write(KEY_HISTORY, json)
        messages.length
      end

      # «Удалить историю»: переписка и сессии не стираются, а уезжают в архив
      # (один слот — последняя удалённая переписка). Лента пустеет, а
      # «Восстановить» возвращает всё как было.
      def clear
        messages = load
        sess = sessions
        unless messages.empty? && sess.empty?
          write(KEY_ARCHIVE, JSON.generate({ 'messages' => messages, 'sessions' => sess, 'at' => Time.now.utc.iso8601 }))
        end
        write(KEY_HISTORY, '[]')
        write(KEY_SESSIONS, '{}')
        { archived: messages.length }
      end

      def archive_info
        raw = read(KEY_ARCHIVE)
        return nil if raw.nil? || raw.empty?
        a = JSON.parse(raw)
        return nil unless a.is_a?(Hash) && a['messages'].is_a?(Array) && !a['messages'].empty?
        { count: a['messages'].length, at: a['at'] }
      rescue JSON::ParserError
        nil
      end

      # «Восстановить историю»: архив встаёт перед текущей перепиской; сессии
      # берутся из архива, если новых ещё нет. Архив после этого пуст.
      def restore
        raw = read(KEY_ARCHIVE)
        return { restored: 0, messages: load, sessions: sessions } if raw.nil? || raw.empty?
        a = JSON.parse(raw)
        archived = a.is_a?(Hash) && a['messages'].is_a?(Array) ? a['messages'] : []
        merged = archived + load
        save(merged)
        current = sessions
        sess = current.empty? && a['sessions'].is_a?(Hash) ? a['sessions'] : current
        save_sessions(sess)
        write(KEY_ARCHIVE, '')
        { restored: archived.length, messages: load, sessions: sess }
      rescue JSON::ParserError
        { restored: 0, messages: load, sessions: sessions }
      end

      # Идентификаторы сессий провайдеров: { 'claude' => 'uuid', 'codex' => 'thread' }.
      # Хранятся в модели, чтобы разговор продолжался после перезапуска
      # SketchUp, пока gateway помнит сессию.
      def sessions
        raw = read(KEY_SESSIONS)
        return {} if raw.nil? || raw.empty?
        parsed = JSON.parse(raw)
        parsed.is_a?(Hash) ? parsed : {}
      rescue JSON::ParserError
        {}
      end

      def save_sessions(hash)
        write(KEY_SESSIONS, JSON.generate(hash || {}))
      end

      def read(key)
        dict = model.attribute_dictionary(DICTIONARY, false)
        return nil unless dict
        value = dict[key]
        value.is_a?(String) ? value : nil
      end

      def write(key, value)
        m = model
        # Прозрачная операция: сливается с предыдущим шагом истории правок,
        # своего пункта в Undo не заводит.
        m.start_operation("#{PLUGIN_NAME}: переписка", true, false, true)
        dict = m.attribute_dictionary(DICTIONARY, true)
        dict[key] = value
        dict[KEY_VERSION] = VERSION
        m.commit_operation
        true
      rescue StandardError
        m.abort_operation rescue nil
        false
      end
    end
  end
end
