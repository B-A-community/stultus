# frozen_string_literal: true
#
# Настройки плагина на этой машине: адрес gateway, пропуск, выбранный
# провайдер и модель. Хранятся через Sketchup.write_default — это реестр
# SketchUp, общий для всех окон и моделей на компьютере.
#
# В файл модели они не пишутся намеренно: адрес сервера и пропуск —
# свойство рабочего места, а не проекта, и уходить вместе с .skp к
# заказчику они не должны.

module BACommunity
  module Stultus
    module Settings
      DEFAULTS = {
        'gateway'  => 'ws://127.0.0.1:8790/ws',
        'token'    => '',
        'provider' => 'claude',
        'model'    => '',
        # Снимок сцены прикладывается к каждому сообщению пользователя.
        'attach_scene' => true,
        # Тема окна: dark | light (дизайн светлой — от ChatGPT, пока заглушка).
        'theme' => 'dark',
        # Лимит времени execute_ruby, секунд; 0 — без лимита. См. Runner: может
        # вызывать нестабильность при прерывании посреди вызова API.
        'ruby_timeout' => 90
      }.freeze

      module_function

      def all
        DEFAULTS.each_with_object({}) do |(key, default), acc|
          value = Sketchup.read_default(PREFS_KEY, key, default)
          acc[key] = value.nil? ? default : value
        end
      end

      def update(hash)
        hash.each do |key, value|
          next unless DEFAULTS.key?(key.to_s)
          Sketchup.write_default(PREFS_KEY, key.to_s, value)
        end
        all
      end
    end
  end
end
