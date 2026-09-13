r = []
EV = 'C:/work/maksar-ruslan/staltus/build/kb/render_events.txt'
def kb_log(line) File.open(EV, 'a') { |f| f.puts("#{Time.now.strftime('%H:%M:%S.%L')} #{line}") } end
begin
  ctx = VRay::Context.active
  s = ctx.scene; rd = ctx.renderer
  out = s['/SettingsOutput']
  $kb_size = [out[:img_width], out[:img_height]]
  s.change { out[:img_width] = 400; out[:img_height] = 225 }
  class KbSub
    def on_state_changed(renderer, old_state, new_state, instant)
      File.open('C:/work/maksar-ruslan/staltus/build/kb/render_events.txt', 'a') { |f| f.puts("#{Time.now.strftime('%H:%M:%S.%L')} state #{old_state} -> #{new_state}") }
      if new_state == :idleDone || new_state == :idleStopped || new_state == :idleError
        # сохранить на главном потоке чуть позже, не из колбэка
        UI.start_timer(0.5, false) do
          begin
            ok1 = renderer.save_vfb_image('C:/work/maksar-ruslan/staltus/build/kb/p08_vfb.png')
            img = renderer.image(do_color_correct: true, strip_alpha: true)
            ok2 = img.save('C:/work/maksar-ruslan/staltus/build/kb/p08_image.png', format: :png)
            File.open('C:/work/maksar-ruslan/staltus/build/kb/render_events.txt', 'a') { |f| f.puts("saved vfb=#{ok1} image=#{ok2} #{img.width}x#{img.height}") }
          rescue => e
            File.open('C:/work/maksar-ruslan/staltus/build/kb/render_events.txt', 'a') { |f| f.puts("save ERROR #{e.class}: #{e.message}") }
          end
        end
      end
    end
    def on_progress(renderer, message, n, count, instant)
      File.open('C:/work/maksar-ruslan/staltus/build/kb/render_events.txt', 'a') { |f| f.puts("progress #{message} #{n}/#{count}") } if n == 0 || n == count
    end
  end
  $kb_sub = KbSub.new
  rd.subscribe($kb_sub)
  kb_log("state before=#{rd.state}")
  t0 = Time.now
  VRay::Command.render_production(context: ctx)
  kb_log("render_production returned after #{((Time.now - t0) * 1000).round} ms; state=#{rd.state}")
  r << "started; state=#{rd.state}"
rescue => e
  r << "ERROR #{e.class}: #{e.message}"
end
File.write('C:/work/maksar-ruslan/staltus/build/kb/p08_render.txt', r.join("\n"))
