# Проверка файла по пути из build/expect.txt: существует ли, PNG ли, размеры.
# Отчёт — build/png_check.txt. Папка тоже допустима: берётся самый свежий PNG.
path = File.read('C:/work/maksar-ruslan/staltus/build/expect.txt', encoding: 'utf-8').strip
path = Dir.glob(File.join(path, '*.png')).max_by { |f| File.mtime(f) } || path if File.directory?(path)
report = if path && File.file?(path)
  head = File.binread(path, 24)
  w, h = head.byteslice(16, 8).unpack('NN')
  png = head.start_with?("\x89PNG\r\n\x1a\n".b)
  "#{path}: #{png ? 'PNG' : 'НЕ PNG'} #{w}×#{h}, #{(File.size(path) / 1024.0 / 1024).round(1)} МБ"
else
  "#{path}: файла нет"
end
File.write('C:/work/maksar-ruslan/staltus/build/png_check.txt', report)
