# Проверка сцены-наложения: страницы, тег, изображение, снимок активной сцены в build/scene_check.png.
m = Sketchup.active_model
tag = m.layers['Stultus · визуализации']
imgs = m.entities.grep(Sketchup::Image)
lines = ["pages: #{m.pages.map(&:name).inspect}", "tag: #{tag ? [tag.visible?] : 'none'}",
         "images: #{imgs.map { |i| [i.layer.name, i.width.to_mm.round, i.height.to_mm.round, i.path.to_s[-24..]] }.inspect}"]
page = m.pages.find { |p| p.name.start_with?('Визуализация') }
if page
  lines << "page hidden layers: #{page.use_hidden_layers?} tag visible in page: #{page.layers.include?(tag)}"
  m.pages.selected_page = page
  UI.start_timer(0.6, false) do
    v = m.active_view; v.refresh
    v.write_image(filename: 'C:/work/maksar-ruslan/staltus/build/scene_check.png', width: 1280, height: (1280.0 * v.vpheight / v.vpwidth).round, antialias: true)
    File.write('C:/work/maksar-ruslan/staltus/build/scene_check.txt', (lines + ['shot ok']).join("\n"))
  end
else
  File.write('C:/work/maksar-ruslan/staltus/build/scene_check.txt', lines.join("\n"))
end
