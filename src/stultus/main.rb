# frozen_string_literal: true
#
# Точка входа расширения: меню, панель инструментов, открытие окна.
#
# Всё остальное подгружается отсюда. Модули маленькие и независимые, чтобы
# каждый можно было проверить через мост :8080 отдельно, не перезапуская
# SketchUp.

require 'json'

module BACommunity
  module Stultus
    %w[constants settings history scene selection runner screenshot dialog].each do |name|
      require File.join(PLUGIN_PATH, name)
    end

    module_function

    # Открывает окно чата (или показывает уже открытое).
    def open
      Dialog.show
    rescue StandardError => e
      UI.messagebox("#{PLUGIN_NAME}: не удалось открыть окно.\n#{e.class}: #{e.message}")
    end

    def install_ui
      return if @ui_installed
      @ui_installed = true

      menu = UI.menu('Extensions')
      menu.add_item("#{PLUGIN_NAME} — чат с ИИ") { open }

      toolbar = UI::Toolbar.new(PLUGIN_NAME)
      command = UI::Command.new(PLUGIN_NAME) { open }
      command.tooltip = "#{PLUGIN_NAME} — чат с ИИ"
      command.status_bar_text = 'Открыть окно чата с нейросетью'
      command.menu_text = PLUGIN_NAME
      small = Icons.path('stultus-24')
      large = Icons.path('stultus-32')
      command.small_icon = small if small
      command.large_icon = large || small if large || small
      toolbar.add_item(command)
      toolbar.restore
    end

    module Icons
      module_function

      # Иконки — PNG из дизайна Graphite (16/24/32, прозрачный фон); если
      # файла нет, SketchUp покажет кнопку без картинки, а не упадёт.
      def path(name)
        dir = File.join(PLUGIN_PATH, 'icons')
        %w[png svg].each do |ext|
          file = File.join(dir, "#{name}.#{ext}")
          return file if File.exist?(file)
        end
        nil
      end
    end

    install_ui
  end
end
