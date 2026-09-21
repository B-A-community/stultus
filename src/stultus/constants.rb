# frozen_string_literal: true

module BACommunity
  module Stultus
    PLUGIN_NAME = 'Stultus'
    # Версию отсюда же читает tools/build_rbz.ps1 — имя пакета не разъезжается с кодом.
    VERSION = '0.2.19'

    # Ключ словаря атрибутов в файле модели. Префикс организации — чтобы не
    # столкнуться с чужими плагинами: словарь один на модель, ключи внутри —
    # только наши.
    DICTIONARY = 'BACommunity_Stultus'

    # Ключ настроек окна (положение/размер HtmlDialog) и настроек плагина
    # в реестре SketchUp (Sketchup.read_default / write_default).
    PREFS_KEY = 'BACommunity_Stultus'

    # Потолок на переписку в файле модели, байт JSON. SketchUp хранит
    # атрибуты прямо в .skp, и раздувать файл перепиской нельзя: старые
    # сообщения отбрасываются с начала, пока не влезет.
    HISTORY_LIMIT = 150_000

    # Сколько символов результата execute_ruby отдаём модели. Дальше — обрезка
    # с пометкой: inspect большого массива сущностей это мегабайты текста.
    RESULT_LIMIT = 20_000

    # Сколько объектов верхнего уровня попадает в снимок сцены.
    SCENE_OBJECT_LIMIT = 200
  end
end
