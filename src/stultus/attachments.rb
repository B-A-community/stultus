# frozen_string_literal: true
#
# Вложения пользователя (картинки к сообщению).
#
# Оригинал сохраняется как есть — без пережатия — в папку рядом с файлом
# модели: «<имя проекта>-content» (для «Дом.skp» → «Дом-content»). У
# несохранённой модели папка во временном месте пользователя. Модели уходит
# именно оригинал; миниатюра только для ленты в окне.

require 'base64'
require 'fileutils'

module BACommunity
  module Stultus
    module Attachments
      module_function

      def dir
        m = Sketchup.active_model
        base = if m.path.to_s.empty?
                 File.join(ENV['LOCALAPPDATA'] || Dir.tmpdir, 'Stultus', 'content', 'unsaved')
               else
                 File.join(File.dirname(m.path), "#{File.basename(m.path, '.*')}-content")
               end
        FileUtils.mkdir_p(base)
        base
      end

      # Сохраняет оригинал, возвращает путь и размер.
      def save(name, base64)
        data = Base64.strict_decode64(base64.to_s)
        raise 'Пустой файл' if data.empty?
        safe = File.basename(name.to_s).gsub(/[\\\/:*?"<>|]+/, '_')
        safe = "image_#{Time.now.strftime('%Y%m%d_%H%M%S')}.png" if safe.empty? || safe == '_'
        path = File.join(dir, safe)
        if File.exist?(path)
          ext = File.extname(safe)
          path = File.join(dir, "#{File.basename(safe, ext)}_#{Time.now.strftime('%H%M%S')}#{ext}")
        end
        File.binwrite(path, data)
        { ok: true, path: path, dir: dir, bytes: data.bytesize }
      end

      # Прочитать файл обратно (для повторной отправки после перезапуска).
      def read(path)
        raise 'Файл не найден' unless File.file?(path.to_s)
        { ok: true, base64: Base64.strict_encode64(File.binread(path)), bytes: File.size(path) }
      end
    end
  end
end
