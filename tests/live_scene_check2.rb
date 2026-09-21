# Повторный снимок сцены после завершения перехода камеры; сравнение размеров вьюпорта.
m = Sketchup.active_model
page = m.pages.find { |p| p.name.start_with?('Визуализация') }
m.pages.selected_page = page
UI.start_timer(3.0, false) do
  v = m.active_view; v.refresh
  cam = v.camera
  v.write_image(filename: 'C:/work/maksar-ruslan/staltus/build/scene_check2.png', source: :framebuffer)
  File.write('C:/work/maksar-ruslan/staltus/build/scene_check2.txt', "vp #{v.vpwidth}x#{v.vpheight} fov #{cam.fov} eye #{cam.eye.to_a.map { |x| x.to_mm.round }} target #{cam.target.to_a.map { |x| x.to_mm.round }}")
end
