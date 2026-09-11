# frozen_string_literal: true
#
# Stultus — регистратор расширения.
#
# Чат с нейросетью внутри SketchUp: окно плагина держит исходящее
# соединение с gateway, а модель (Claude Code или Codex) работает с открытой
# сценой через инструменты плагина. Сам код инструментов — в src/stultus/.

require 'sketchup.rb'
require 'extensions.rb'

module BACommunity
  module Stultus
    ROOT_PATH   = File.dirname(File.expand_path(__FILE__)).freeze
    PLUGIN_PATH = File.join(ROOT_PATH, 'stultus').freeze
  end
end

# Имя и версия живут вместе с остальными константами: ничего ниже по дереву
# не зависит от того, что регистратор уже отработал.
require File.join(BACommunity::Stultus::PLUGIN_PATH, 'constants')

module BACommunity
  module Stultus
    unless defined?(@loaded)
      @loaded = true

      extension = SketchupExtension.new(PLUGIN_NAME, File.join(PLUGIN_PATH, 'main.rb'))
      extension.version     = VERSION
      extension.creator     = 'B&A community'
      extension.copyright   = '2026 B&A community'
      extension.description =
        'Чат с нейросетью (Claude Code / Codex) внутри SketchUp: модель видит ' \
        'открытую сцену, строит и правит геометрию через Ruby API, по запросу ' \
        'получает снимок вьюпорта. Переписка хранится в файле модели.'

      Sketchup.register_extension(extension, true)
    end
  end
end
