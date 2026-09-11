# Отправить сообщение через окно плагина (как если бы пользователь напечатал).
d = BACommunity::Stultus::Dialog.instance_variable_get(:@dialog)
text = File.read('C:/work/maksar-ruslan/staltus/build/msg.txt', encoding: 'utf-8')
d.execute_script("document.getElementById('providerSelect').value='codex'; document.getElementById('providerSelect').dispatchEvent(new Event('change')); document.getElementById('input').value=#{text.to_json}; document.getElementById('btnSend').click();")
File.write('C:/work/maksar-ruslan/staltus/build/live_send_report.txt', "sent: #{text}")
