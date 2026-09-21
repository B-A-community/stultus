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
      # Полный большой кадр (8K — десятки мегабайт) собирается из кусков.
      MAX_FULL_BYTES = 400 * 1024 * 1024
      module_function

      def root
        File.join(ENV['LOCALAPPDATA'] || ENV['XDG_DATA_HOME'] || Dir.tmpdir, 'Stultus', 'renders')
      end

      def paths(id)
        raise 'Некорректный идентификатор кадра' unless id.to_s.match?(/\A[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\z/)
        [File.join(root, "#{id}.png"), File.join(root, "#{id}-source.png")]
      end

      # Превью большого кадра: его показывает лента, полный файл только на экспорт.
      def preview_path(id)
        File.join(root, "#{id}-preview.png")
      end

      # Данные кадра: камера снимка, размер, задание — для сцены-наложения.
      def meta_path(id)
        paths(id)
        File.join(root, "#{id}.json")
      end

      def meta(id)
        path = meta_path(id)
        File.file?(path) ? JSON.parse(File.read(path, encoding: 'utf-8')) : nil
      rescue StandardError
        nil
      end

      def save_meta(id, hash)
        return { ok: false, error: 'Нет данных' } unless hash.is_a?(Hash)
        FileUtils.mkdir_p(root)
        File.write(meta_path(id), JSON.generate(hash), encoding: 'utf-8')
        { ok: true }
      end


      def decode(value)
        raise 'Изображение слишком большое' if value.to_s.bytesize > MAX_BYTES * 4 / 3 + 4
        data = Base64.strict_decode64(value.to_s)
        raise 'Некорректное изображение PNG' unless data.start_with?("\x89PNG\r\n\x1a\n".b) && data.bytesize >= 24
        data
      end

      # preview: true — картинка это превью большого кадра, полный файл придёт
      # кусками (append_chunk); иначе картинка и есть кадр.
      def store(id, image, source, preview: false, meta: nil)
        target, original = paths(id)
        rendered_data, source_data = decode(image), decode(source)
        FileUtils.mkdir_p(root)
        File.binwrite(preview ? preview_path(id) : target, rendered_data)
        File.binwrite(original, source_data)
        save_meta(id, meta) if meta.is_a?(Hash)
        { ok: true, id: id }
      end

      # Сведения о полном файле кадра: есть ли превью (значит кадр большой), размер.
      def file_info(id)
        target, = paths(id)
        return { ok: false, error: 'Кадр не найден на этом компьютере.' } unless File.file?(target)
        head = File.binread(target, 24)
        w, h = head.byteslice(16, 8).unpack('NN')
        { ok: true, bytes: File.size(target), width: w, height: h, preview: File.file?(preview_path(id)) }
      end

      # Кусок полного файла для отправки на сервер: base64, индекс и число кусков.
      def read_chunk(id, index, size)
        target, = paths(id)
        return { ok: false, error: 'Кадр не найден на этом компьютере.' } unless File.file?(target)
        size = size.to_i.clamp(64 * 1024, 8 * 1024 * 1024)
        total = (File.size(target) + size - 1) / size
        index = index.to_i
        return { ok: false, error: 'Нет такого куска' } if index.negative? || index >= total
        data = File.binread(target, size, index * size)
        { ok: true, index: index, total: total, data: Base64.strict_encode64(data) }
      end

      # Кусок полного кадра. Пишем в .part, на последнем куске проверяем
      # заголовок PNG и переименовываем — недокачанный файл не станет кадром.
      def append_chunk(id, index, total, data)
        target, = paths(id)
        part = "#{target}.part"
        raise 'Некорректный кусок' if index.negative? || total <= 0 || index >= total
        bytes = Base64.strict_decode64(data.to_s)
        FileUtils.mkdir_p(root)
        File.delete(part) if index.zero? && File.exist?(part)
        raise 'Файл слишком большой' if File.exist?(part) && File.size(part) + bytes.bytesize > MAX_FULL_BYTES
        File.open(part, 'ab') { |f| f.write(bytes) }
        return { ok: true, done: false, received: index + 1 } unless index == total - 1

        head = File.binread(part, 8)
        raise 'Собранный файл не PNG' unless head == "\x89PNG\r\n\x1a\n".b
        File.delete(target) if File.exist?(target)
        File.rename(part, target)
        { ok: true, done: true, bytes: File.size(target), path: target }
      rescue StandardError => e
        File.delete(part) if part && File.exist?(part)
        { ok: false, error: "#{e.class}: #{e.message}" }
      end

      def read(id)
        target, original = paths(id)
        shown = File.file?(preview_path(id)) ? preview_path(id) : target
        return { ok: false, error: 'Кадр не найден на этом компьютере.' } unless File.file?(shown) && File.file?(original)
        raise 'Изображение слишком большое' if [shown, original].any? { |file| File.size(file) > MAX_BYTES }
        { ok: true, image: Base64.strict_encode64(File.binread(shown)), source: Base64.strict_encode64(File.binread(original)), meta: meta(id) }
      end

      # Сохранить кадр по пути из чата (без диалога). Файл — только с
      # расширением; папка, слеш на конце или путь без расширения — папка с
      # файлом stultus_<дата>.png. Те же правила, что у save_path V-Ray.
      def export_to(id, path)
        target, = paths(id)
        return { ok: false, error: 'Кадр не найден на этом компьютере.' } unless File.file?(target)
        raw = path.to_s.strip
        return { ok: false, error: 'Путь не задан.' } if raw.empty?
        dest = File.expand_path(raw.tr('\\', '/'))
        if File.directory?(dest) || raw.end_with?('/', '\\') || File.extname(dest).empty?
          FileUtils.mkdir_p(dest)
          dest = File.join(dest, "stultus_#{Time.now.strftime('%Y%m%d_%H%M%S')}.png")
        else
          FileUtils.mkdir_p(File.dirname(dest))
          dest = "#{dest}.png" unless File.extname(dest).casecmp('.png').zero?
        end
        FileUtils.cp(target, dest)
        { ok: true, path: dest, bytes: File.size(dest) }
      rescue StandardError => e
        { ok: false, error: "#{e.class}: #{e.message}" }
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
