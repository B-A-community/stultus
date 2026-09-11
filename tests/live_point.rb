# Переключить плагин на другой gateway и переоткрыть окно.
# Адрес и пропуск читаются из build/gateway.txt (две строки: url, token) —
# файл не в репозитории.
url, token = File.read('C:/work/maksar-ruslan/staltus/build/gateway.txt').lines.map(&:strip)
BACommunity::Stultus::Settings.update('gateway' => url, 'token' => token)
d = BACommunity::Stultus::Dialog.instance_variable_get(:@dialog)
d.close if d
BACommunity::Stultus.open
