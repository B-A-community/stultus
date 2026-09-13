r = []
begin
  ctx = VRay::Context.active(false)
  r << "active(false)=#{ctx.class} nil=#{ctx.nil?}"
  ctx ||= VRay::Context.active
  r << "active=#{ctx.class} model_same=#{ctx.model.equal?(Sketchup.active_model)}"
  r << "scene=#{ctx.scene.class} renderer=#{ctx.renderer.class}"
rescue => e
  r << "ERROR #{e.class}: #{e.message}"
end
File.write('C:/work/maksar-ruslan/staltus/build/kb/p01_context.txt', r.join("\n"))
