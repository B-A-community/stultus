load 'C:/work/maksar-ruslan/staltus/src/stultus/dialog.rb'
BACommunity::Stultus::Dialog.log('--- reopen2 ---')
BACommunity::Stultus.open
BACommunity::Stultus::Dialog.log("after open: #{!BACommunity::Stultus::Dialog.instance_variable_get(:@dialog).nil?}")
