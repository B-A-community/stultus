m = Sketchup.active_model
ws = m.entities.grep(Sketchup::ComponentInstance).select { |e| e.definition.name == 'Окно 1200' }
m.selection.clear; m.selection.add(ws)
