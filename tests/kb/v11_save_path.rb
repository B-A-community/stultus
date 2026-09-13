load 'C:/work/maksar-ruslan/staltus/src/stultus/vray.rb'
M = BACommunity::Stultus::VRayRender
File.write('C:/work/maksar-ruslan/staltus/build/kb/v11.txt', '')
M.render(width: 320, height: 180, preset: 'draft', timeout: 60, save_to: 'C:/work/maksar-ruslan/staltus/build/kb/out_dir') do |r1|
  File.open('C:/work/maksar-ruslan/staltus/build/kb/v11.txt', 'a') { |f| f.puts("dir: ok=#{r1[:ok]} saved_to=#{r1[:saved_to]} err=#{r1[:save_error]}") }
  M.render(width: 320, height: 180, preset: 'draft', timeout: 60, save_to: 'C:\work\maksar-ruslan\staltus\build\kb\named\кадр') do |r2|
    File.open('C:/work/maksar-ruslan/staltus/build/kb/v11.txt', 'a') { |f| f.puts("file: ok=#{r2[:ok]} saved_to=#{r2[:saved_to]} err=#{r2[:save_error]}") }
  end
end
