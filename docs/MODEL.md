# Modelo AstroTwin

Geometría original generada proceduralmente en Blender 5.3.0 mediante `scripts/blender/build_astrotwin.py`, `anatomy.py` y `sdf.py`. No se descargaron modelos externos, no hay servicios de generación pagos ni texturas remotas. Las fórmulas SDF y operaciones de intersección producen una representación humana estilizada para demostración; no tiene validación anatómica clínica.

## Cinco capas alineadas

- `layer_skeleton`: cráneo, columna, costillas/esternón/clavículas, pelvis, brazos/manos y piernas/pies.
- `layer_organs`: `heart`, `lungs`, `brain`, `digestive`, `kidneys`.
- `layer_muscle`: grupos musculares separados derivados de la misma superficie corporal.
- `layer_skin`: malla continua con manos, pies y rostro simplificado; shader holográfico en runtime.
- `layer_suit`: traje biométrico, placas, casco, visor y núcleo de pecho. El HUD visor/pecho se compone en runtime.

Las coordenadas fuente Blender son Z arriba, frente -Y; el exportador glTF las convierte a Y arriba y frente +Z, con pies en y=0 y altura aproximada 1,76 m. Anchors `anchor_heart`, `anchor_lungs`, `anchor_brain`, `anchor_digestive`, `anchor_suit` se exportan como nodos y guían el anillo independiente de la visibilidad de capas.

## Archivos y evidencia

- `public/models/astrotwin_human.glb`: Draco, 683.724 bytes en la última generación.
- `public/models/astrotwin_human.blend`: fuente editable, 6.152.815 bytes.
- `scripts/blender/out/astrotwin_human_raw.glb`: 4.736.368 bytes sin compresión.
- `public/models/astrotwin_human.stats.json`: conteos y prueba de contención contra SDF de piel.
- `public/models/mesh-audit.json`: auditoría de geometría/normales.
- `public/models/draco/*`: decodificador redistribuido desde dependencia Three.js; funciona localmente.

49 mallas, 260.886 triángulos en todas las capas sumadas. Las capas desactivadas no se dibujan. La generación aplica límites de polígonos por parte; las coordenadas internas se proyectan al interior de la piel después de suavizado/decimación para conservar alineación. La última auditoría informó cero vértices no finitos, normales inválidas y triángulos degenerados. Las pruebas geométricas comprueban consistencia técnica, no exactitud médica.

## Reproducir

```bash
cd /home/bunuelo/astrotwin-3d
~/.local/bin/blender -b --factory-startup --python scripts/blender/build_astrotwin.py -- --out public/models --quick
~/.local/bin/blender -b public/models/astrotwin_human.blend --python scripts/blender/audit_model.py
```

`--quick` usa vóxeles más grandes con los mismos límites de polígonos. Sin esa opción aumenta la resolución de generación. La escena anterior se conservó en `scripts/blender/previous/`.

Antigravity escribió la base del generador, se quedó sin cuota antes de completar el pipeline y no entregó visor. Codex corrigió mallas/exportador/contención, ejecutó Blender, exportó/validó GLB y construyó el visor. Aunque Orca solicitó Sonnet 5.5, el runtime de Antigravity mostró Opus 5.5; no se atribuye esta entrega a Sonnet confirmado.
