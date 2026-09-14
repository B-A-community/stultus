# Отправить сообщение через окно плагина от имени пользователя.
# Текст — build/msg.txt, провайдер — build/provider.txt (claude|codex).
d = BACommunity::Stultus::Dialog.instance_variable_get(:@dialog)
text = File.read('C:/work/maksar-ruslan/staltus/build/msg.txt', encoding: 'utf-8')
prov = File.exist?('C:/work/maksar-ruslan/staltus/build/provider.txt') ? File.read('C:/work/maksar-ruslan/staltus/build/provider.txt').strip : 'claude'
d.execute_script("var ps=document.getElementById('providerSelect'); if(ps.value!=='#{prov}'){ps.value='#{prov}'; ps.dispatchEvent(new Event('change'));} document.getElementById('input').value=#{text.to_json}; document.getElementById('btnSend').click();")
