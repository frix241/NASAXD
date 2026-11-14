#!/usr/bin/env bash
# Descarga los mapas reales de la NASA / USGS (dominio público) a public/textures.
# Solo hace falta correrlo una vez con internet; después la app funciona sin red.
# Requiere curl e ImageMagick (magick).
set -euo pipefail
cd "$(dirname "$0")/.." && mkdir -p public/textures && tmp=$(mktemp -d)
get() { curl -fsSL --max-time 180 -A "Mozilla/5.0" -o "$tmp/$1" "$2"; }
# Tierra de día: Blue Marble Next Generation (NASA Earth Observatory)
get earth.jpg "https://assets.science.nasa.gov/content/dam/science/esd/eo/images/bmng/bmng-topography-bathymetry/december/world.topo.bathy.200412.3x5400x2700.jpg"
# Tierra de noche: Black Marble 2016 (NASA Earth Observatory / Suomi NPP)
get night.jpg "https://assets.science.nasa.gov/content/dam/science/esd/eo/images/imagerecords/144000/144898/BlackMarble_2016_01deg.jpg"
# Luna: CGI Moon Kit, mosaico de color de LRO (NASA SVS)
get moon.tif "https://svs.gsfc.nasa.gov/vis/a000000/a004700/a004720/lroc_color_poles_2k.tif"
# Marte: mosaico global de color Viking MDIM 2.1 (USGS Astrogeology / NASA)
get mars.jpg "https://astrogeology.usgs.gov/ckan/dataset/7131d503-cdc9-45a5-8f83-5126c0fd397e/resource/6afad901-1caa-48a7-8b62-3911da0004c2/download/mars_viking_mdim21_clrmosaic_global_1024.jpg"
magick "$tmp/earth.jpg" -quality 84 -interlace Plane public/textures/earth.jpg
magick "$tmp/night.jpg" -resize 2700x1350 -quality 82 public/textures/earth-night.jpg
magick "$tmp/moon.tif[0]" -quality 86 public/textures/moon.jpg
magick "$tmp/mars.jpg" -quality 90 public/textures/mars.jpg
rm -rf "$tmp"; ls -la public/textures
