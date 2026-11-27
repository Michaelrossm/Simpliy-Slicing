# Feldinventar: S3D-Quelldatei

Eintrag pro oberstem XML-Feld. Nicht als portiert bezeichnete Felder sind offen. Verschachtelte Optionen stehen im Original und in der Auto-Konfigurationsinventur.

| S3D-Feld | Quellwert / Struktur | Status im Entwurf |
|---|---|---|
| baseProfile | Prusa Research Original Prusa i3 MK3 | offen / nicht einzeln validiert |
| extruder (Primary Extruder) | Struktur: 20 Eintraege | siehe Extruder- und Materialabschnitt |
| primaryExtruder | *Primary Extruder* | offen / nicht einzeln validiert |
| layerHeight | 0.10000 | Prusa layer_height |
| topSolidLayers | 3 | Prusa top_solid_layers |
| bottomSolidLayers | 3 | Prusa bottom_solid_layers |
| outlinePerimeters | 2 | Prusa perimeters |
| useVaseMode | 0 | offen / nicht einzeln validiert |
| useAdaptiveLayerHeights | 0 | offen / nicht einzeln validiert |
| minAdaptiveLayerHeight | 0.08000 | offen / nicht einzeln validiert |
| maxAdaptiveLayerHeight | 0.30000 | offen / nicht einzeln validiert |
| adaptiveSmoothingLevel | 5 | offen / nicht einzeln validiert |
| horizontalOuterCompensation | 0.00000 | offen / nicht einzeln validiert |
| horizontalInnerCompensation | 0.00000 | offen / nicht einzeln validiert |
| firstLayerUnits | *percentage*, absolute | offen / nicht einzeln validiert |
| firstLayerHeightPercentage | 140 | Prusa first_layer_height |
| firstLayerWidthPercentage | 110 | offen / nicht einzeln validiert |
| firstLayerSpeedPercentage | 30 | Prusa first_layer_speed (Naeherung) |
| firstLayerHeightAbsolute | 0.30000 | offen / nicht einzeln validiert |
| firstLayerWidthAbsolute | 0.40000 | offen / nicht einzeln validiert |
| firstLayerSpeedAbsolute | 900.00000 | offen / nicht einzeln validiert |
| startPointStrategy | random, closest, *aligned* | offen / nicht einzeln validiert |
| alignStartPointsX | 0.00000 | offen / nicht einzeln validiert |
| alignStartPointsY | 0.00000 | offen / nicht einzeln validiert |
| restrictStartPoints | 1 | offen / nicht einzeln validiert |
| perimeterPrintingOrder | *inside_out*, outside_in | offen / nicht einzeln validiert |
| islandPrintingOrder | *closest*, consistent, combined | offen / nicht einzeln validiert |
| printInfillBeforePerimeters | 0 | offen / nicht einzeln validiert |
| useSkirt | 0 | offen / nicht einzeln validiert |
| skirtExtruder | *Primary Extruder*, All Extruders | offen / nicht einzeln validiert |
| skirtLayers | 1 | offen / nicht einzeln validiert |
| skirtOffset | 0.00000 | offen / nicht einzeln validiert |
| skirtOutlines | 5 | offen / nicht einzeln validiert |
| useRaft | 0 | offen / nicht einzeln validiert |
| raftExtruder | *Primary Extruder* | offen / nicht einzeln validiert |
| raftBaseLayers | 2 | offen / nicht einzeln validiert |
| raftTopLayers | 3 | offen / nicht einzeln validiert |
| raftOffset | 3.00000 | offen / nicht einzeln validiert |
| raftSeparationDistance | 0.14000 | offen / nicht einzeln validiert |
| raftSpeedUnits | *percentage*, absolute | offen / nicht einzeln validiert |
| raftSpeedPercentage | 30 | offen / nicht einzeln validiert |
| raftSpeedAbsolute | 600.00000 | offen / nicht einzeln validiert |
| usePrimePillar | 0 | offen / nicht einzeln validiert |
| primePillarExtruder | Primary Extruder, *All Extruders* | offen / nicht einzeln validiert |
| primePillarWidth | 12.00000 | offen / nicht einzeln validiert |
| primePillarLocation | north, north_east, east, south_east, south, south_west, west, *north_west* | offen / nicht einzeln validiert |
| primePillarSpeedPercentage | 100 | offen / nicht einzeln validiert |
| primePillarInfillPercentage | 100 | offen / nicht einzeln validiert |
| autoStopPrimePillar | 1 | offen / nicht einzeln validiert |
| primePillarLayersAfterAutoStop | 0 | offen / nicht einzeln validiert |
| useOozeShield | 0 | offen / nicht einzeln validiert |
| oozeShieldExtruder | Primary Extruder, *All Extruders* | offen / nicht einzeln validiert |
| oozeShieldOffset | 2.00000 | offen / nicht einzeln validiert |
| oozeShieldOutlines | 1 | offen / nicht einzeln validiert |
| oozeShieldSidewallShape | vertical, *waterfall*, contoured | offen / nicht einzeln validiert |
| oozeShieldSidewallAngle | 30 | offen / nicht einzeln validiert |
| oozeShieldSpeedPercentage | 100 | offen / nicht einzeln validiert |
| autoStopOozeShield | 1 | offen / nicht einzeln validiert |
| oozeShieldLayersAfterAutoStop | 0 | offen / nicht einzeln validiert |
| sparseInfillExtruder | *Primary Extruder* | offen / nicht einzeln validiert |
| sparseInfillPattern | aligned, rectilinear, grid, triangular, sinusoidal, wiggle, fast_honeycomb, full_honeycomb, octahedral, cubic, *gyroid* | offen / nicht einzeln validiert |
| sparseInfillRotation | 30 | offen / nicht einzeln validiert |
| sparseInfillPercentage | 20 | Prusa fill_density |
| sparseInfillExtrusionWidthPercentage | 110 | offen / nicht einzeln validiert |
| sparseInfillCombinedLayers | 1 | offen / nicht einzeln validiert |
| denseInfillLayers | 0 | offen / nicht einzeln validiert |
| denseInfillPercentage | 50 | offen / nicht einzeln validiert |
| infillOutlineOverlapPercentage | 20 | offen / nicht einzeln validiert |
| minInfillLength | 5.00000 | offen / nicht einzeln validiert |
| externalInfillPattern | aligned, rectilinear, *concentric* | offen / nicht einzeln validiert |
| externalInfillRotation | 15 | offen / nicht einzeln validiert |
| solidInfillThresholdArea | 10.00000 | offen / nicht einzeln validiert |
| solidInfillExtraExpansion | 0.00000 | offen / nicht einzeln validiert |
| useMonotonic | 1 | offen / nicht einzeln validiert |
| useDiaphragm | 0 | offen / nicht einzeln validiert |
| diaphragmSolidLayers | 3 | offen / nicht einzeln validiert |
| diaphragmSpacingLayers | 20 | offen / nicht einzeln validiert |
| topLayerExtraExpansion | 1.00000 | offen / nicht einzeln validiert |
| topLayerExtrusionModifier | 101 | offen / nicht einzeln validiert |
| overrideFanSpeedForTopLayer | 1 | offen / nicht einzeln validiert |
| topLayerFanSpeedPercentage | 80 | offen / nicht einzeln validiert |
| useIroning | 0 | offen / nicht einzeln validiert |
| ironingOutlineOffsetPercentage | 50 | offen / nicht einzeln validiert |
| ironingExtrusionWidthPercentage | 25 | offen / nicht einzeln validiert |
| ironingExtrusionModifier | 15 | offen / nicht einzeln validiert |
| ironingSpeedModifier | 30 | offen / nicht einzeln validiert |
| sparseSupportExtruder | *Primary Extruder* | offen / nicht einzeln validiert |
| sparseSupportInfillPattern | *aligned*, rectilinear, grid, triangular | offen / nicht einzeln validiert |
| sparseSupportInfillRotation | 45 | offen / nicht einzeln validiert |
| sparseSupportInfillPercentage | 30 | offen / nicht einzeln validiert |
| sparseSupportOutlines | 0 | offen / nicht einzeln validiert |
| sparseSupportCombinedLayers | 1 | offen / nicht einzeln validiert |
| upperDenseSupportLayers | 0 | offen / nicht einzeln validiert |
| lowerDenseSupportLayers | 0 | offen / nicht einzeln validiert |
| denseSupportExtruder | *Primary Extruder* | offen / nicht einzeln validiert |
| denseSupportInfillPercentage | 70 | offen / nicht einzeln validiert |
| denseSupportExtraExpansion | 0.00000 | offen / nicht einzeln validiert |
| baseSupportLayers | 2 | offen / nicht einzeln validiert |
| supportInflationDistance | 0.10000 | offen / nicht einzeln validiert |
| supportHorizontalPartOffset | 0.30000 | offen / nicht einzeln validiert |
| supportUpperSeparationLayers | 1 | offen / nicht einzeln validiert |
| supportLowerSeparationLayers | 1 | offen / nicht einzeln validiert |
| temperatureController (Primary Extruder) | Struktur: 9 Eintraege | siehe Materialtabelle und Prusa filament_settings |
| temperatureController (Heated Bed) | Struktur: 9 Eintraege | siehe Materialtabelle und Prusa filament_settings |
| fan (Cooling Fan) | Struktur: 8 Eintraege | nicht vollstaendig uebernommen |
| defaultPrintSpeed | 5160.00000 | Prusa speed fields; mm/min zu mm/s |
| outerPerimeterSpeedPercentage | 50 | offen / nicht einzeln validiert |
| innerPerimeterSpeedPercentage | 80 | offen / nicht einzeln validiert |
| topLayerSpeedPercentage | 25 | offen / nicht einzeln validiert |
| solidInfillSpeedPercentage | 80 | offen / nicht einzeln validiert |
| sparseSupportSpeedPercentage | 80 | offen / nicht einzeln validiert |
| denseSupportSpeedPercentage | 70 | offen / nicht einzeln validiert |
| travelSpeedXY | 12000.00000 | Prusa travel_speed |
| travelSpeedZ | 1000.00000 | Prusa travel_speed_z |
| reduceSpeedForQuickLayers | 1 | offen / nicht einzeln validiert |
| speedMaxQuickLayerTime | 15.00000 | offen / nicht einzeln validiert |
| minQuickLayerSpeedPercentage | 20 | offen / nicht einzeln validiert |
| reduceSpeedForShortPerimeters | 1 | offen / nicht einzeln validiert |
| speedMaxShortPerimeterLength | 80.00000 | offen / nicht einzeln validiert |
| minShortPerimeterSpeedPercentage | 50 | offen / nicht einzeln validiert |
| reduceSpeedForMaxFlowRate | 1 | offen / nicht einzeln validiert |
| accelXY | 1200.00000 | offen / nicht einzeln validiert |
| accelZ | 120.00000 | offen / nicht einzeln validiert |
| accelE | 5000.00000 | offen / nicht einzeln validiert |
| jerkXY | 600.00000 | offen / nicht einzeln validiert |
| jerkZ | 24.00000 | offen / nicht einzeln validiert |
| jerkE | 270.00000 | offen / nicht einzeln validiert |
| exportFileFormat | *gcode*, x3g, gx, g3drem, 3w, makerbot, bfb | offen / nicht einzeln validiert |
| useStickyCommands | 1 | offen / nicht einzeln validiert |
| use5D | 1 | offen / nicht einzeln validiert |
| relativeExtrusionDistances | 0 | Prusa use_relative_e_distances |
| allowExtruderAxisZeroing | 1 | offen / nicht einzeln validiert |
| independentExtruderAxes | 0 | offen / nicht einzeln validiert |
| includeM10123 | 0 | offen / nicht einzeln validiert |
| includeThumbnailImages | 1 | offen / nicht einzeln validiert |
| thumbnailImageEncoding | *standard*, creality, qidi, weedo, snapmaker, mks | offen / nicht einzeln validiert |
| thumbnailImageSizes | 300/300, 64/64 | offen / nicht einzeln validiert |
| x3gMachineProfile | c3, c4, cp4, cpp, t6, t7, t7d, r1, r1d, *r2*, r2h, r2x, m180, 3dimulti, 3dipro | offen / nicht einzeln validiert |
| overrideStepsPerMillimeter | 0 | offen / nicht einzeln validiert |
| stepsPerMillimeterX | 88.57319 | offen / nicht einzeln validiert |
| stepsPerMillimeterY | 88.57319 | offen / nicht einzeln validiert |
| stepsPerMillimeterZ | 400.00000 | offen / nicht einzeln validiert |
| stepsPerMillimeterA | 96.27520 | offen / nicht einzeln validiert |
| stepsPerMillimeterB | 96.27520 | offen / nicht einzeln validiert |
| xyzFileFormatVersion | *1*, 2, 3, 5 | offen / nicht einzeln validiert |
| makerBotMachineProfile | mini_4, mini_8, *replicator_5*, replicator_b, z18_6, fire_e, lava_f, magma_10, sketch, sketch_large | offen / nicht einzeln validiert |
| makerBotModelExtruder | *mk13*, mk13_impla, mk14, mk14_c, mk14_hot, mk14_e, sketch_extruder | offen / nicht einzeln validiert |
| makerBotSupportExtruder | *mk14_s*, mk14_hot_s | offen / nicht einzeln validiert |
| makerBotModelMaterial | *pla*, im-pla, nylon, nylon-cf, nylon12-cf, pet, abs, asa, pc-abs, pc-abs-fr, metal, abs-wss1 | offen / nicht einzeln validiert |
| makerBotSupportMaterial | *pva*, sr30, wss1 | offen / nicht einzeln validiert |
| globalOffsetX | 0.00000 | offen / nicht einzeln validiert |
| globalOffsetY | 0.00000 | offen / nicht einzeln validiert |
| globalOffsetZ | 0.00000 | offen / nicht einzeln validiert |
| applyToolheadOffsets | 0 | offen / nicht einzeln validiert |
| buildVolumeShape | *rectangular*, cylindrical | offen / nicht einzeln validiert |
| buildVolumeX | 250.00000 | Prusa bed_shape |
| buildVolumeY | 210.00000 | Prusa bed_shape |
| buildVolumeZ | 210.00000 | Prusa max_print_height |
| buildVolumeDiameter | 200.00000 | offen / nicht einzeln validiert |
| originOffsetX | 0.00000 | offen / nicht einzeln validiert |
| originOffsetY | 0.00000 | offen / nicht einzeln validiert |
| originOffsetZ | 0.00000 | offen / nicht einzeln validiert |
| homingDirectionX | *min*, center, max | offen / nicht einzeln validiert |
| homingDirectionY | *min*, center, max | offen / nicht einzeln validiert |
| homingDirectionZ | *min*, center, max | offen / nicht einzeln validiert |
| mirrorVisualX | 0 | offen / nicht einzeln validiert |
| mirrorVisualY | 0 | offen / nicht einzeln validiert |
| mirrorVisualZ | 0 | offen / nicht einzeln validiert |
| machineBackgroundModel |  | offen / nicht einzeln validiert |
| startingScript | M98 P"0:/sys/print/start.g" S[bed0_temperature] H[extruder0_temperature] X[build_min_x] Y[build_min_y] I[build_max_x] J[build_max_y] | RRF M98; Platzhalter teilweise uebersetzt |
| preLayerChangeScript |  | offen / nicht einzeln validiert |
| postLayerChangeScript |  | offen / nicht einzeln validiert |
| preRetractionScript |  | offen / nicht einzeln validiert |
| postRetractionScript |  | offen / nicht einzeln validiert |
| preToolChangeScript |  | offen / nicht einzeln validiert |
| postToolChangeScript |  | offen / nicht einzeln validiert |
| processChangeScript | ; object: Teil1 | offen / nicht einzeln validiert |
| endingScript | M98 P"0:/sys/print/End.g" | RRF M98; Makroinhalte ungeklaert |
| postProcessingScript |  | offen / nicht einzeln validiert |
| useBridging | 1 | offen / nicht einzeln validiert |
| bridgingThresholdArea | 50.00000 | offen / nicht einzeln validiert |
| bridgingInfillExtraExpansion | 0.00000 | offen / nicht einzeln validiert |
| bridgingExtrusionModifier | 103 | offen / nicht einzeln validiert |
| bridgingSpeedModifier | 100 | offen / nicht einzeln validiert |
| overrideFanSpeedForBridging | 1 | offen / nicht einzeln validiert |
| bridgingFanSpeedPercentage | 20 | offen / nicht einzeln validiert |
| useFixedBridgingAngle | 0 | offen / nicht einzeln validiert |
| fixedBridgingAngle | 0 | offen / nicht einzeln validiert |
| applyBridgingToPerimeters | 0 | offen / nicht einzeln validiert |
| bridgingPerimeterExtraOverlap | 0.00000 | offen / nicht einzeln validiert |
| minBridgingPerimeterLength | 10.00000 | offen / nicht einzeln validiert |
| useToolChangeRetraction | 0 | offen / nicht einzeln validiert |
| toolChangeRetractDistance | 12.00000 | offen / nicht einzeln validiert |
| toolChangeExtraRestartDistance | -0.50000 | offen / nicht einzeln validiert |
| toolChangeRetractSpeed | 600.00000 | offen / nicht einzeln validiert |
| toolChangePrimeOnFirstUse | 0 | offen / nicht einzeln validiert |
| toolChangeRetractAtEnd | 0 | offen / nicht einzeln validiert |
| externalThinWallType | *perimeters_only*, single_extrusions | offen / nicht einzeln validiert |
| internalThinWallType | perimeters_only, *single_extrusions*, gap_fill | offen / nicht einzeln validiert |
| thinWallAllowedOverlapPercentage | 26 | offen / nicht einzeln validiert |
| singleExtrusionMinLength | 1.00000 | offen / nicht einzeln validiert |
| singleExtrusionMinWidthPercentage | 20 | offen / nicht einzeln validiert |
| singleExtrusionMaxWidthPercentage | 220 | offen / nicht einzeln validiert |
| singleExtrusionEndpointExtensionDistance | 0.20000 | offen / nicht einzeln validiert |
| onlyRetractWhenCrossingOutlines | 1 | offen / nicht einzeln validiert |
| retractBetweenLayers | 0 | offen / nicht einzeln validiert |
| retractOnTopLayers | 1 | offen / nicht einzeln validiert |
| useRetractionMinTravel | 0 | offen / nicht einzeln validiert |
| retractionMinTravel | 3.00000 | offen / nicht einzeln validiert |
| useRetractionMinExtrusion | 0 | offen / nicht einzeln validiert |
| retractionMinExtrusion | 3.00000 | offen / nicht einzeln validiert |
| onlyVerticalLiftOnTopLayers | 1 | offen / nicht einzeln validiert |
| retractWhileWiping | 1 | offen / nicht einzeln validiert |
| wipingMode | *outer_perimeter*, any_perimeter, any_feature | offen / nicht einzeln validiert |
| avoidCrossingOutlines | 1 | offen / nicht einzeln validiert |
| maxMovementDetourFactor | 3.00000 | offen / nicht einzeln validiert |
| openLoopSlicingBehavior | *discard*, heal, thicken | offen / nicht einzeln validiert |
| openLoopThickenWidth | 0.50000 | offen / nicht einzeln validiert |
| slicingRegionRepairMode | *alternating*, positive, merge_all | offen / nicht einzeln validiert |
| autoConfigureCategory (Material) | PLA, ABS, PET, Nylon, TPU 82A, Easy ABS-Sunlu, pet-amazon-grau, Fiberflex-cr20-cr, Prusa-PC-Blend_CF_Black, petg-owl, PETG-schwarz jayo, CR-Pla-weiß, Pla Overture-schwarz, Pla-dual-esun, CR3d Petg sonder, TPu 85 CR3d nat ... | siehe S3D-Autokonfigurationen.json |
| autoConfigureCategory (Quality) | Fast, *Medium*, High, 1,5, 0,8 | siehe S3D-Autokonfigurationen.json |
| autoConfigureCategory (Ergänzung) | Raft, *Brim*, Skirt, Skirt-Raft, nichts | siehe S3D-Autokonfigurationen.json |
| autoConfigureCategory (Prozessänderung) | *Teil1*, Teil2, Teil3, Teil 4, Teil 5, Teil 6 | siehe S3D-Autokonfigurationen.json |
