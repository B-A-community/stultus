# frozen_string_literal: true

require 'base64'
require 'fileutils'
require 'json'
require 'tmpdir'

module BACommunity
  module Stultus
    # Images live on this computer, not in the .skp attribute dictionary.
    module RenderAssets
      MAX_BYTES = 24 * 1024 * 1024
      module_function

      def root
        File.join(ENV['LOCALAPPDATA'] || ENV['XDG_DATA_HOME'] || Dir.tmpdir, 'Stultus', 'renders')
      end

      def paths(id)
        raise 'Некорректный идентификатор кадра' unless id.to_s.match?(/\A[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\z/)
        [File.join(root, "#{id}.png"), File.join(root, "#{id}-source.png")]
      end

      def decode(value)
        raise 'Изображение слишком большое' if value.to_s.bytesize > MAX_BYTES * 4 / 3 + 4
        data = Base64.strict_decode64(value.to_s)
        raise 'Некорректное изображение PNG' unless data.start_with?("\x89PNG\r\n\x1a\n".b) && data.bytesize >= 24
        data
      end

      def store(id, image, source)
        target, original = paths(id)
        rendered_data, source_data = decode(image), decode(source)
        FileUtils.mkdir_p(root)
        File.binwrite(target, rendered_data)
        File.binwrite(original, source_data)
        { ok: true, id: id }
      end

      def read(id)
        target, original = paths(id)
        return { ok: false, error: 'Кадр не найден на этом компьютере.' } unless File.file?(target) && File.file?(original)
        raise 'Изображение слишком большое' if [target, original].any? { |file| File.size(file) > MAX_BYTES }
        { ok: true, image: Base64.strict_encode64(File.binread(target)), source: Base64.strict_encode64(File.binread(original)) }
      end

      def export(id)
        target, = paths(id)
        return { ok: false, error: 'Кадр не найден на этом компьютере.' } unless File.file?(target)
        filename = UI.savepanel('Сохранить визуализацию', nil, "stultus-#{id[0, 8]}.png")
        return { ok: true, cancelled: true } unless filename
        unless File.extname(filename).downcase == '.png'
          filename += '.png'
          if File.exist?(filename)
            answer = UI.messagebox("Заменить существующий файл?\n#{filename}", MB_YESNO)
            return { ok: true, cancelled: true } unless answer == IDYES
          end
        end
        return { ok: true, path: filename } if File.expand_path(filename) == File.expand_path(target)
        FileUtils.cp(target, filename)
        { ok: true, path: filename }
      end
    end
  end
end
