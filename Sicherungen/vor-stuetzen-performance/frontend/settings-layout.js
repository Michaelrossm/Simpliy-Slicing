// Aufteilung des Prozessdialogs: Reiter -> Liste links -> Gruppen rechts.
// Jede Zeile in einer Gruppe: "<engine-schluessel> <kurze Beschriftung>".
// Der Test tests/settings-layout.test.mjs prueft, dass jeder Parameter der Engine genau einmal vorkommt.
const page = (name, ...groups) => ({name, groups});
const group = (title, rows, extra = {}) => ({
  title,
  ...extra,
  rows: rows.trim().split('\n').map(line => {
    const [key, ...label] = line.trim().split(' ');
    return {key, label: label.join(' ')};
  }),
});

export const LAYOUT = {
  'Extruder': {list: 'Extruder Liste', pages: [
    page('Haupt-Extruder',
      group('Überblick', `
        nozzle_diameter Düsendurchmesser
        filament_diameter Filamentdurchmesser
        extrusion_multiplier Extrusionsmultiplikator
        extrusion_width Extrusionsbreite
        automatic_extrusion_widths Breite automatisch berechnen`),
      group('Einzug (Retraction)', `
        retract_length Einzugslänge
        retract_restart_extra Zusätzliche Wiederanlauflänge
        retract_speed Einzugsgeschwindigkeit
        deretract_speed Wiedereinzugsgeschwindigkeit
        retract_lift Vertikales Anheben (Z-Hop)
        retract_before_travel Einzug ab Bewegung von
        retract_layer_change Einzug bei Schichtwechsel
        only_retract_when_crossing_perimeters Nur beim Queren von Wänden
        use_firmware_retraction Firmware-Einzug`),
      group('Abwischen', `
        wipe Düse beim Einzug abwischen
        retract_before_wipe Einzug vor dem Abwischen`)),
    page('Extrusionsbreiten',
      group('Breite je Werkzeugweg', `
        first_layer_extrusion_width Erste Schicht
        perimeter_extrusion_width Innenwände
        external_perimeter_extrusion_width Außenwand
        infill_extrusion_width Füllung
        solid_infill_extrusion_width Massive Füllung
        top_infill_extrusion_width Oberseite
        support_material_extrusion_width Stützen`)),
    page('Z-Hop und Rampe',
      group('Anheben begrenzen', `
        retract_lift_above Nur oberhalb von Z
        retract_lift_below Nur unterhalb von Z`),
      group('Rampe', `
        travel_ramping_lift Rampe statt senkrecht anheben
        travel_max_lift Maximale Anhebung
        travel_slope Steigungswinkel
        travel_lift_before_obstacle Steiler vor Hindernissen`)),
    page('Kalibrierung',
      group('Pressure Advance', `
        pressure_advance Betriebsart
        pressure_advance_value Wert
        enable_pressure_advance_during_ramming Auch beim Rammen`),
      group('Schrumpfung', `
        filament_shrinkage_compensation_xy Ausgleich XY
        filament_shrinkage_compensation_z Ausgleich Z
        used_filament_compensation Ausgleich Filamentverbrauch`),
      group('Durchsatz', `
        filament_max_volumetric_speed Maximaler Volumenfluss
        filament_infill_max_speed Max. Füllung ohne Kreuzung
        filament_infill_max_crossing_speed Max. Füllung mit Kreuzung`)),
    page('Werkzeugzuordnung',
      group('Werkzeug je Druckbereich', `
        perimeter_extruder Wände
        infill_extruder Füllung
        solid_infill_extruder Massive Füllung
        support_material_extruder Stützen, Raft, Skirt
        support_material_interface_extruder Stützen-Kontaktschichten
        wipe_tower_extruder Reinigungsturm
        extruder_offset Versatz der Extruder
        toolchange_ordering Reihenfolge der Wechsel`),
      group('Einzug beim Werkzeugwechsel', `
        retract_length_toolchange Einzugslänge
        retract_restart_extra_toolchange Zusätzliche Wiederanlauflänge`),
      group('Materialgrenzen', `
        interface_shells Hüllen zwischen Materialien
        mmu_segmented_region_max_width Max. Breite bemalter Bereiche
        mmu_segmented_region_interlocking_depth Verzahnung bemalter Bereiche
        interlocking_beam Balkenverzahnung
        interlocking_beam_width Balkenbreite
        interlocking_beam_layer_count Schichten je Balken
        interlocking_depth Verzahnungstiefe
        interlocking_orientation Ausrichtung
        interlocking_boundary_avoidance Randabstand`)),
    page('Filamentwechsel',
      group('Maschine', `
        single_extruder_multi_material Ein Extruder, mehrere Materialien
        single_extruder_multi_material_priming Alle Werkzeuge vorfüllen
        cooling_tube_retraction Position Kühlrohr
        cooling_tube_length Länge Kühlrohr
        parking_pos_retraction Parkposition
        extra_loading_move Zusätzliche Ladestrecke
        multimaterial_purging Reinigungsvolumen
        high_current_on_filament_swap Hoher Motorstrom beim Wechsel
        filament_change_time Dauer des Wechsels`),
      group('Laden und Entladen', `
        filament_loading_speed_start Laden, Beginn
        filament_loading_speed Laden
        filament_unloading_speed_start Entladen, Beginn
        filament_unloading_speed Entladen
        filament_toolchange_delay Wartezeit nach Entladen
        filament_cooling_moves Kühlbewegungen
        filament_cooling_initial_speed Erste Kühlbewegung
        filament_cooling_final_speed Letzte Kühlbewegung
        filament_stamping_distance Stamping-Abstand
        filament_stamping_loading_speed Stamping-Geschwindigkeit`),
      group('Rammen und Spülen', `
        filament_ramming_parameters Rammparameter
        filament_ramming_initial_delay Pause vor dem Rammen
        filament_ramming_temperature_delta Temperaturänderung
        filament_multitool_ramming Rammen bei Mehrwerkzeug
        filament_multitool_ramming_flow Rammfluss
        filament_multitool_ramming_volume Rammvolumen
        filament_flush_speed Spülgeschwindigkeit
        filament_flush_volume Spülvolumen
        filament_purge_multiplier Faktor Reinigungsvolumen
        filament_minimal_purge_on_wipe_tower Mindestmenge im Turm`)),
  ]},

  'Schicht': {list: 'Schicht Bereiche', pages: [
    page('Schichten',
      group('Schichteinstellungen', `
        layer_height Schichthöhe
        first_layer_height Erste Schicht
        top_solid_layers Massive Schichten oben
        bottom_solid_layers Massive Schichten unten`),
      group('Grenzen', `
        min_layer_height Kleinste Schichthöhe
        max_layer_height Größte Schichthöhe
        variable_layer_height Variable Schichthöhe erlauben`)),
    page('Ober- und Unterseite',
      group('Muster', `
        top_fill_pattern Muster oben
        bottom_fill_pattern Muster unten`),
      group('Mindeststärke', `
        top_solid_min_thickness Oben
        bottom_solid_min_thickness Unten`),
      group('Nur eine Wand', `
        top_one_perimeter_type Auf Oberseiten
        only_one_perimeter_first_layer In der ersten Schicht`),
      group('Bügeln', `
        ironing Bügeln aktivieren
        ironing_type Flächen
        ironing_flowrate Fluss
        ironing_spacing Linienabstand
        ironing_speed Geschwindigkeit`)),
  ]},

  'Wände': {list: 'Wände', pages: [
    page('Wände',
      group('Wände', `
        perimeters Anzahl Wände
        spiral_vase Vasenmodus
        external_perimeters_first Außenwand zuerst`),
      group('Wandqualität', `
        thin_walls Dünne Wände erkennen
        gap_fill_enabled Lücken füllen
        extra_perimeters Zusätzliche Wände bei Bedarf
        extra_perimeters_on_overhangs Zusätzliche Wände an Überhängen
        ensure_vertical_shell_thickness Senkrechte Wandstärke sichern
        overhangs Überhängende Wände erkennen
        thick_bridges Dicke Brücken`),
      group('Fuzzy Skin', `
        fuzzy_skin Anwendung
        fuzzy_skin_thickness Stärke
        fuzzy_skin_point_dist Punktabstand`)),
    page('Naht',
      group('Startpunkte', `
        seam_position Nahtposition
        seam_gap_distance Nahtlücke
        staggered_inner_seams Innennähte versetzen`),
      group('Schräge Naht (Scarf)', `
        scarf_seam_placement Anwendung
        scarf_seam_only_on_smooth Nur auf glatten Konturen
        scarf_seam_start_height Starthöhe
        scarf_seam_length Länge
        scarf_seam_max_segment_length Max. Segmentlänge
        scarf_seam_entire_loop Um die ganze Kontur
        scarf_seam_on_inner_perimeters Auch an Innenwänden`)),
  ]},

  'Ergänzungen': {list: 'Ergänzungen', pages: [
    page('Skirt und Brim',
      group('Skirt', `
        skirts Anzahl Konturen
        skirt_distance Abstand zum Teil
        skirt_height Höhe in Schichten
        min_skirt_length Mindestlänge Filament
        draft_shield Windschutz`),
      group('Brim', `
        brim_type Brim-Typ
        brim_width Breite
        brim_separation Abstand zum Teil`)),
    page('Raft',
      group('Raft', `
        raft_layers Schichten
        raft_contact_distance Luftspalt
        raft_expansion Überstand
        raft_first_layer_density Dichte erste Schicht
        raft_first_layer_expansion Überstand erste Schicht`)),
    page('Reinigungsturm',
      group('Form', `
        wipe_tower Reinigungsturm verwenden
        wipe_tower_width Breite
        wipe_tower_brim_width Brim-Breite
        wipe_tower_cone_angle Winkel Stützkegel
        wipe_tower_bridging Max. Brückenlänge
        wipe_tower_no_sparse_layers Keine spärlichen Schichten`),
      group('Spülen', `
        wipe_tower_extra_spacing Linienabstand
        wipe_tower_extra_flow Zusätzlicher Fluss
        wipe_tower_max_purge_speed Max. Geschwindigkeit
        wipe_tower_acceleration Beschleunigung
        wipe_tower_deretraction_spread_ratio Wiedereinzug verteilen`)),
    page('Nachtropfen',
      group('Nachtropfschutz', `
        ooze_prevention Nachtropfschutz aktivieren
        standby_temperature_delta Absenkung im Standby`)),
  ]},

  'Füllung': {list: 'Füllung Bereiche', pages: [
    page('Allgemein',
      group('Füllung', `
        fill_density Fülldichte
        fill_pattern Füllmuster
        fill_angle Grundwinkel
        infill_overlap Überlappung mit Wand
        infill_first Füllung vor Wänden`),
      group('Verankerung', `
        infill_anchor Ankerlänge
        infill_anchor_max Maximale Ankerlänge`),
      group('Schichten kombinieren', `
        infill_every_layers Kombinieren alle
        automatic_infill_combination Automatisch kombinieren
        automatic_infill_combination_max_layer_height Max. kombinierte Höhe`)),
    page('Massiv und Brücken',
      group('Massive Füllung', `
        solid_infill_every_layers Massive Schicht alle
        solid_infill_below_area Massiv unter Fläche von`),
      group('Brücken', `
        bridge_angle Brückenwinkel
        bridge_flow_ratio Brückenfluss`)),
  ]},

  'Stützen': {list: 'Stützen Bereiche', pages: [
    page('Prusa-Stützen',
      group('Erzeugung', `
        support_material Stützen erzeugen
        support_material_style Art
        support_material_threshold Überhangwinkel
        support_material_buildplate_only Nur vom Druckbett
        dont_support_bridges Brücken nicht stützen
        support_material_enforce_layers Erste Schichten erzwingen`),
      group('Muster', `
        support_material_pattern Muster
        support_material_spacing Linienabstand
        support_material_angle Winkel
        support_material_first_layer_density Dichte erste Schicht`),
      group('Abstand zum Teil', `
        support_material_contact_distance Z-Abstand oben
        support_material_bottom_contact_distance Z-Abstand unten
        support_material_xy_spacing XY-Abstand`)),
    page('Kontaktschichten',
      group('Kontaktschichten', `
        support_material_interface_layers Schichten oben
        support_material_bottom_interface_layers Schichten unten
        support_material_interface_pattern Muster
        support_material_interface_spacing Linienabstand
        support_material_interface_contact_loops Kontaktschleifen`)),
    page('Organisch',
      group('Organische Stützen', `
        support_tree_angle Max. Astwinkel
        support_tree_angle_slow Bevorzugter Astwinkel
        support_tree_tip_diameter Spitzendurchmesser
        support_tree_branch_diameter Astdurchmesser
        support_tree_branch_diameter_angle Verdickungswinkel
        support_tree_branch_diameter_double_wall Doppelwand ab
        support_tree_branch_distance Astabstand
        support_tree_top_rate Astdichte`)),
    page('Form',
      group('Geometrie', `
        support_material_synchronize_layers Mit Teilschichten synchronisieren
        support_material_with_sheath Mit Umhüllung
        support_material_closing_radius Schließradius
        support_material_first_layer_expansion Erste Schicht verbreitern`)),
  ]},

  'Temperatur': {list: 'Temperaturregler', pages: [
    page('Haupt-Extruder',
      group('Sollwerte pro Schicht', `
        first_layer_temperature Schicht 1
        temperature Ab Schicht 2`, {table: ['Schichtnummer', 'Temperatur']}),
      group('Regler', `
        idle_temperature Leerlauftemperatur
        autoemit_temperature_commands Befehle automatisch ausgeben`)),
    page('Druckbett',
      group('Sollwerte pro Schicht', `
        first_layer_bed_temperature Schicht 1
        bed_temperature Ab Schicht 2`, {table: ['Schichtnummer', 'Temperatur']}),
      group('Regler', `
        bed_temperature_extruder Vorgabe durch Extruder`)),
    page('Bauraum',
      group('Bauraumheizung', `
        chamber_temperature Solltemperatur
        chamber_minimal_temperature Mindesttemperatur`)),
  ]},

  'Kühlung': {list: 'Lüfter Liste', pages: [
    page('Bauteillüfter',
      group('Allgemein', `
        fan_always_on Lüfter immer laufen lassen
        min_fan_speed Grunddrehzahl
        bridge_fan_speed Drehzahl bei Brücken`),
      group('Sollwerte pro Schicht', `
        disable_fan_first_layers Lüfter aus für die ersten
        full_fan_speed_layer Volle Drehzahl ab`, {fanTable: true}),
      group('Lüfterdrehzahl überschreiben', `
        cooling Bei schnellen Schichten anpassen
        fan_below_layer_time Erhöhen bei Schichtdauer unter
        slowdown_below_layer_time Maximum bei Schichtdauer unter
        max_fan_speed Maximale Schnellschicht-Drehzahl`)),
    page('Überhänge',
      group('Drehzahl nach Überlappung', `
        enable_dynamic_fan_speeds Dynamische Drehzahl
        overhang_fan_speed_0 0 % (Brücke)
        overhang_fan_speed_1 25 %
        overhang_fan_speed_2 50 %
        overhang_fan_speed_3 75 %`)),
    page('Verlangsamen',
      group('Schnelle Schichten verlangsamen', `
        min_print_speed Mindestgeschwindigkeit
        cooling_slowdown_logic Verfahren
        cooling_perimeter_transition_distance Übergangsstrecke Wand`)),
  ]},

  'Geschwindigkeiten': {list: 'Geschwindigkeit Bereiche', pages: [
    page('Druck und Leerfahrt',
      group('Druckgeschwindigkeit', `
        perimeter_speed Innenwände
        external_perimeter_speed Außenwand
        small_perimeter_speed Kleine Konturen
        infill_speed Füllung
        solid_infill_speed Massive Füllung
        top_solid_infill_speed Oberseite
        gap_fill_speed Lückenfüllung
        bridge_speed Brücken
        over_bridge_speed Über Brücken
        support_material_speed Stützen
        support_material_interface_speed Stützen-Kontakt
        over_support_interface_speed Tempolimit über Stützkontakt`),
      group('Leerfahrt', `
        travel_speed X/Y
        travel_speed_z Z`)),
    page('Erste Schicht',
      group('Erste Schicht', `
        first_layer_speed Allgemein
        first_layer_perimeter_speed Innenwände
        first_layer_external_perimeter_speed Außenwand
        first_layer_infill_speed Füllung
        first_layer_solid_infill_speed Massive Füllung
        first_layer_top_solid_infill_speed Oberseite
        first_layer_gap_fill_speed Lückenfüllung
        first_layer_support_material_speed Stützen
        first_layer_speed_over_raft Über dem Raft`)),
    page('Überhänge',
      group('Nach Überlappung', `
        enable_dynamic_overhang_speeds Dynamische Geschwindigkeit
        overhang_speed_0 0 % (Brücke)
        overhang_speed_1 25 %
        overhang_speed_2 50 %
        overhang_speed_3 75 %`)),
    page('Beschleunigung',
      group('Druck', `
        default_acceleration Standard
        perimeter_acceleration Innenwände
        external_perimeter_acceleration Außenwand
        infill_acceleration Füllung
        solid_infill_acceleration Massive Füllung
        top_solid_infill_acceleration Oberseite
        bridge_acceleration Brücken
        over_support_interface_acceleration Limit über Stützkontakt`),
      group('Erste Schicht', `
        first_layer_acceleration Erste Schicht
        first_layer_acceleration_over_raft Über dem Raft`),
      group('Leerfahrt', `
        travel_acceleration Allgemein
        travel_short_distance_acceleration Kurze Wege`)),
    page('Durchsatz',
      group('Begrenzung', `
        max_print_speed Maximale Geschwindigkeit
        max_volumetric_speed Maximaler Volumenfluss`),
      group('Druckausgleich', `
        max_volumetric_extrusion_rate_slope_positive Anstieg
        max_volumetric_extrusion_rate_slope_negative Abfall`)),
    page('Maschinengrenzen',
      group('Verwendung', `
        machine_limits_usage Grenzen verwenden für`),
      group('Geschwindigkeit', `
        machine_max_feedrate_x X
        machine_max_feedrate_y Y
        machine_max_feedrate_z Z
        machine_max_feedrate_e E
        machine_min_extruding_rate Minimum beim Drucken
        machine_min_travel_rate Minimum bei Leerfahrt`),
      group('Beschleunigung', `
        machine_max_acceleration_x X
        machine_max_acceleration_y Y
        machine_max_acceleration_z Z
        machine_max_acceleration_e E
        machine_max_acceleration_extruding Beim Drucken
        machine_max_acceleration_retracting Beim Einzug
        machine_max_acceleration_travel Bei Leerfahrt`),
      group('Ruck', `
        machine_max_jerk_x X
        machine_max_jerk_y Y
        machine_max_jerk_z Z
        machine_max_jerk_e E
        machine_max_junction_deviation Junction Deviation`)),
  ]},

  'Drucker': {list: 'Drucker Bereiche', pages: [
    {name: 'Netzwerk', groups: [], network: true},
    page('G-Code',
      group('G-Code-Optionen', `
        gcode_flavor Firmware
        use_relative_e_distances Relative Extrusion
        use_volumetric_e Volumetrisches E
        binary_gcode Binärer G-Code
        gcode_comments Ausführliche Kommentare
        gcode_label_objects Objekte kennzeichnen
        remaining_times Restzeit ausgeben
        z_offset Z-Versatz`),
      group('Datei', `
        output_filename_format Dateiname
        thumbnails Miniaturbilder
        thumbnails_format Bildformat`)),
    page('Maschine',
      group('Bauraum', `
        bed_shape Bettkontur
        max_print_height Maximale Druckhöhe
        bed_custom_model Bettmodell
        bed_custom_texture Bett-Textur`),
      group('Freiraum am Druckkopf', `
        extruder_clearance_radius Radius
        extruder_clearance_height Höhe`),
      group('Fähigkeiten', `
        silent_mode Leisemodus
        stuck_filament_detection Filamentstau-Erkennung
        prefer_clockwise_movements Uhrzeigersinn bevorzugen`)),
  ]},

  'Skripte': {list: 'Skript Liste', pages: [
    page('Start',
      group('Start-Skript', `
        start_gcode Drucker
        start_filament_gcode Filament`, {wide: true})),
    page('Schichtwechsel',
      group('Schichtwechsel-Skript', `
        before_layer_gcode Vor dem Wechsel
        layer_gcode Nach dem Wechsel`, {wide: true})),
    page('Werkzeugwechsel',
      group('Werkzeugwechsel-Skript', `
        toolchange_gcode Werkzeugwechsel
        between_objects_gcode Zwischen Objekten`, {wide: true})),
    page('Ende',
      group('End-Skript', `
        end_filament_gcode Filament
        end_gcode Drucker`, {wide: true})),
    page('Pause und Farbe',
      group('Sonderbefehle', `
        pause_print_gcode Pause
        color_change_gcode Farbwechsel
        template_custom_gcode Eigene Vorlage`, {wide: true})),
    page('Nachbearbeitung',
      group('Nachbearbeitung', `
        post_process Externe Skripte
        gcode_substitutions Ersetzungen`, {wide: true})),
  ]},

  'Andere': {list: 'Weitere Bereiche', pages: [
    page('Material',
      group('Material', `
        filament_type Typ
        filament_vendor Hersteller
        filament_colour Farbe
        filament_density Dichte
        filament_cost Kosten
        filament_spool_weight Spulengewicht
        filament_soluble Löslich
        filament_abrasive Abrasiv`)),
    page('Notizen',
      group('Notizen', `
        notes Prozess
        filament_notes Filament
        printer_notes Drucker`, {wide: true})),
    page('Profilverweise',
      group('Drucker', `
        printer_vendor Hersteller
        printer_model Modell
        printer_variant Variante`),
      group('Standardprofile', `
        default_print Prozess
        default_tool_print Werkzeug
        default_material Material`)),
  ]},

  'Fortgeschritten': {list: 'Fortgeschritten', pages: [
    page('Slicing',
      group('Maßhaltigkeit', `
        xy_size_compensation Maßausgleich XY
        elefant_foot_compensation Elefantenfuß`),
      group('Verfahren', `
        slicing_mode Slicing-Modus
        slice_closing_radius Lücken schließen bis
        complete_objects Objekte nacheinander drucken`),
      group('Auflösung', `
        resolution Slicing-Auflösung
        gcode_resolution G-Code-Auflösung
        arc_fitting Bögen G2/G3`),
      group('Bewegung', `
        avoid_crossing_perimeters Wände nicht queren
        avoid_crossing_perimeters_max_detour Maximaler Umweg
        avoid_crossing_curled_overhangs Gewölbte Überhänge umfahren`)),
    page('Dünne Wände',
      group('Perimetergenerator', `
        perimeter_generator Generator
        min_bead_width Minimale Linienbreite
        min_feature_size Kleinstes Detail
        wall_transition_angle Übergangswinkel
        wall_transition_length Übergangslänge
        wall_transition_filter_deviation Übergangsfilter
        wall_distribution_count Verteilung`)),
    page('Freie Parameter',
      group('JSON für Makros', `
        custom_parameters_print Prozess
        custom_parameters_printer Drucker
        custom_parameters_filament Filament`, {wide: true})),
  ]},
};

// Multimaterial: Werkzeugwechsler, Mehrfarbdruck und Materialwechsel an einer Stelle (vor Fortgeschritten).
{
  const take = (tab, name) => {
    const pages = LAYOUT[tab].pages, i = pages.findIndex(p => p.name === name);
    return i < 0 ? [] : pages.splice(i, 1);
  };
  const special = {list: 'Multimaterial', pages: [{name: 'Material je Werkzeug', groups: [], slots: true},
    ...take('Extruder', 'Werkzeugzuordnung'), ...take('Extruder', 'Filamentwechsel'), ...take('Ergänzungen', 'Reinigungsturm'),
    ...take('Ergänzungen', 'Nachtropfen'), ...take('Skripte', 'Werkzeugwechsel'), ...take('Skripte', 'Pause und Farbe'),
  ]};
  const ordered = {};
  for (const [tab, value] of Object.entries(LAYOUT)) {
    if (tab === 'Fortgeschritten') ordered['Multimaterial'] = special;
    ordered[tab] = value;
    delete LAYOUT[tab];
  }
  Object.assign(LAYOUT, ordered);
}

// Neuordnung (0.13.5): kleinere, klar benannte Reiter. Gruppen werden nur verschoben, keine Einstellung geht verloren.
{
  const before = new Set();
  for (const {pages} of Object.values(LAYOUT)) for (const p of pages) for (const g of p.groups) for (const r of g.rows) before.add(r.key);
  const special = Object.fromEntries(Object.entries(LAYOUT).flatMap(([tab, l]) => l.pages.filter(p => p.network || p.slots).map(p => [`${tab}/${p.name}`, p])));
  const take = (tab, page, title, rename) => {
    const g = LAYOUT[tab]?.pages.find(p => p.name === page)?.groups.find(x => x.title === title);
    if (!g) throw Error(`Gruppe fehlt: ${tab} / ${page} / ${title}`);
    return rename ? {...g, title: rename} : g;
  };
  const tab = (list, ...groups) => ({list, pages: [{name: list, groups}]});
  const only = (g, key, title = g.title) => ({...g, title, rows: g.rows.filter(r => r.key === key)});
  const next = {
    // links Extruderliste, rechts alle Werte des gewaehlten Extruders samt Einzug (kein eigener Einzug-Reiter).
    'Extruder': {list: 'Extruder', pages: [{name: 'Extruder', extruders: true, groups: [
      take('Extruder', 'Haupt-Extruder', 'Überblick', 'Allgemein'),
      take('Extruder', 'Haupt-Extruder', 'Einzug (Retraction)', 'Überquell-Kontrolle'),
      take('Extruder', 'Haupt-Extruder', 'Abwischen'),
      take('Extruder', 'Z-Hop und Rampe', 'Anheben begrenzen', 'Z-Hop nur in diesem Bereich'),
      take('Extruder', 'Z-Hop und Rampe', 'Rampe', 'Rampe statt senkrechtem Anheben'),
      take('Multimaterial', 'Werkzeugzuordnung', 'Einzug beim Werkzeugwechsel'),
      take('Extruder', 'Extrusionsbreiten', 'Breite je Werkzeugweg', 'Extrusionsbreiten')]}]},
    'Schicht': tab('Schicht',
      take('Schicht', 'Schichten', 'Schichteinstellungen'),
      take('Schicht', 'Schichten', 'Grenzen', 'Variable Schichthöhe'),
      take('Schicht', 'Ober- und Unterseite', 'Muster', 'Muster oben und unten'),
      take('Schicht', 'Ober- und Unterseite', 'Mindeststärke', 'Mindeststärke oben und unten'),
      take('Schicht', 'Ober- und Unterseite', 'Nur eine Wand'),
      take('Schicht', 'Ober- und Unterseite', 'Bügeln')),
    'Wände': tab('Wände',
      take('Wände', 'Wände', 'Wände'),
      take('Wände', 'Wände', 'Wandqualität'),
      take('Wände', 'Naht', 'Startpunkte', 'Naht'),
      take('Wände', 'Naht', 'Schräge Naht (Scarf)'),
      take('Wände', 'Wände', 'Fuzzy Skin'),
      take('Fortgeschritten', 'Dünne Wände', 'Perimetergenerator')),
    'Ergänzungen': LAYOUT['Ergänzungen'],
    'Füllung': LAYOUT['Füllung'],
    'Stützen': LAYOUT['Stützen'],
    'Temperatur': {...LAYOUT['Temperatur'], controllers: true},
    'Kühlung': {...LAYOUT['Kühlung'], fans: true},
    'Geschwindigkeiten': tab('Geschwindigkeiten',
      take('Geschwindigkeiten', 'Druck und Leerfahrt', 'Druckgeschwindigkeit'),
      take('Geschwindigkeiten', 'Druck und Leerfahrt', 'Leerfahrt'),
      take('Geschwindigkeiten', 'Erste Schicht', 'Erste Schicht'),
      take('Geschwindigkeiten', 'Überhänge', 'Nach Überlappung', 'Überhänge nach Überlappung'),
      take('Geschwindigkeiten', 'Maschinengrenzen', 'Verwendung', 'Maschinengrenzen'),
      take('Geschwindigkeiten', 'Maschinengrenzen', 'Geschwindigkeit', 'Maschine: Geschwindigkeit'),
      take('Geschwindigkeiten', 'Maschinengrenzen', 'Beschleunigung', 'Maschine: Beschleunigung'),
      take('Geschwindigkeiten', 'Maschinengrenzen', 'Ruck', 'Maschine: Ruck')),
    'Beschleunigung': tab('Beschleunigung',
      take('Geschwindigkeiten', 'Beschleunigung', 'Druck', 'Beschleunigung beim Drucken'),
      take('Geschwindigkeiten', 'Beschleunigung', 'Erste Schicht', 'Beschleunigung erste Schicht'),
      take('Geschwindigkeiten', 'Beschleunigung', 'Leerfahrt', 'Beschleunigung Leerfahrt'),
      take('Geschwindigkeiten', 'Durchsatz', 'Begrenzung', 'Durchsatz begrenzen'),
      take('Geschwindigkeiten', 'Durchsatz', 'Druckausgleich', 'Durchsatzänderung')),
    'Material': tab('Material',
      take('Andere', 'Material', 'Material', 'Materialdaten'),
      take('Extruder', 'Kalibrierung', 'Pressure Advance'),
      take('Extruder', 'Kalibrierung', 'Schrumpfung'),
      take('Extruder', 'Kalibrierung', 'Durchsatz', 'Filament-Durchsatz')),
    'Multimaterial': {list: 'Multimaterial', pages: [special['Multimaterial/Material je Werkzeug'], {name: 'Multimaterial', groups: [
      take('Multimaterial', 'Werkzeugzuordnung', 'Werkzeug je Druckbereich'),
      take('Multimaterial', 'Werkzeugzuordnung', 'Materialgrenzen'),
      take('Multimaterial', 'Reinigungsturm', 'Form', 'Reinigungsturm'),
      take('Multimaterial', 'Reinigungsturm', 'Spülen', 'Reinigungsturm: Spülen'),
      take('Multimaterial', 'Nachtropfen', 'Nachtropfschutz')]}]},
    'Filamentwechsel': tab('Filamentwechsel',
      take('Multimaterial', 'Filamentwechsel', 'Maschine', 'MMU mit einem Extruder'),
      take('Multimaterial', 'Filamentwechsel', 'Laden und Entladen'),
      take('Multimaterial', 'Filamentwechsel', 'Rammen und Spülen')),
    'Drucker': {list: 'Drucker', pages: [special['Drucker/Netzwerk'], {name: 'Drucker', groups: [
      take('Drucker', 'G-Code', 'G-Code-Optionen'),
      take('Drucker', 'G-Code', 'Datei', 'G-Code-Datei'),
      take('Drucker', 'Maschine', 'Bauraum'),
      take('Drucker', 'Maschine', 'Freiraum am Druckkopf'),
      take('Drucker', 'Maschine', 'Fähigkeiten'),
      take('Andere', 'Profilverweise', 'Drucker', 'Profilverweis Drucker'),
      take('Andere', 'Profilverweise', 'Standardprofile')]}]},
    // Alle Skripte an einer Stelle, je Ereignis ein Unterreiter.
    'Skripte': {list: 'Skripte', scripts: true, pages: [
      {name: 'Start', groups: [take('Skripte', 'Start', 'Start-Skript')]},
      {name: 'Schichtwechsel', groups: [take('Skripte', 'Schichtwechsel', 'Schichtwechsel-Skript')]},
      {name: 'Werkzeugwechsel', groups: [only(take('Multimaterial', 'Werkzeugwechsel', 'Werkzeugwechsel-Skript'), 'toolchange_gcode')]},
      {name: 'Objektwechsel', groups: [only(take('Multimaterial', 'Werkzeugwechsel', 'Werkzeugwechsel-Skript'), 'between_objects_gcode', 'Objektwechsel-Skript')]},
      {name: 'Pause / Farbwechsel', groups: [take('Multimaterial', 'Pause und Farbe', 'Sonderbefehle', 'Pause und Farbwechsel')]},
      {name: 'Ende', groups: [take('Skripte', 'Ende', 'End-Skript')]},
      {name: 'Nachbearbeitung', groups: [take('Skripte', 'Nachbearbeitung', 'Nachbearbeitung')]}]},
    'Fortgeschritten': {list: 'Fortgeschritten', pages: [{name: 'Fortgeschritten', groups: [
      take('Fortgeschritten', 'Slicing', 'Maßhaltigkeit'),
      take('Fortgeschritten', 'Slicing', 'Verfahren', 'Slicing-Verfahren'),
      take('Fortgeschritten', 'Slicing', 'Auflösung'),
      take('Fortgeschritten', 'Slicing', 'Bewegung', 'Wege'),
      take('Andere', 'Notizen', 'Notizen')]}, {name: 'Freie Parameter', groups: [take('Fortgeschritten', 'Freie Parameter', 'JSON für Makros')]}]},
  };
  const after = new Set();
  for (const {pages} of Object.values(next)) for (const p of pages) for (const g of p.groups) for (const r of g.rows) after.add(r.key);
  const lost = [...before].filter(k => !after.has(k));
  if (lost.length || after.size !== before.size) throw Error(`Neuordnung unvollständig: ${lost.join(', ')}`);
  for (const key of Object.keys(LAYOUT)) delete LAYOUT[key];
  Object.assign(LAYOUT, next);
  // Sonderreiter: Offsets je Auto-Konfigurations-Option (keine eigenen Engine-Einstellungen).
  LAYOUT['Auto-Konfig-Offset'] = {list: 'Auto-Konfig-Offset', offsets: true, pages: [{name: 'Auto-Konfig-Offset', groups: []}]};
  // Favoriten: eigene Auswahl beliebiger Einstellungen (nur Anzeige, keine eigenen Engine-Werte).
  LAYOUT['Favoriten'] = {list: 'Favoriten', favorites: true, pages: [{name: 'Favoriten', groups: []}]};
}

export const TABS = Object.keys(LAYOUT);

/** Schluessel -> {label, tab, page, pageIndex, group} */
export const PLACE = new Map();
for (const [tab, {pages}] of Object.entries(LAYOUT)) {
  pages.forEach((p, pageIndex) => {
    for (const g of p.groups) {
      for (const row of g.rows) PLACE.set(row.key, {label: row.label, tab, page: p.name, pageIndex, group: g.title});
    }
  });
}
