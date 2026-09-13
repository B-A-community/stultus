r = []
begin
  rd = VRay::Context.active.renderer
  r << "state=#{rd.state.inspect} render_mode=#{rd.render_mode.inspect} thread_count=#{rd.thread_count}"
  r << "in_process=#{rd.in_process?} dr=#{rd.dr_enabled?} keep_interactive=#{rd.keep_interactive_running?}"
rescue => e
  r << "ERROR #{e.class}: #{e.message}"
end
File.write('C:/work/maksar-ruslan/staltus/build/kb/p02_renderer_state.txt', r.join("\n"))
