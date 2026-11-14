"""Audit source mesh geometry; invoked after build with Blender --background FILE."""
import bpy, json, math, os
from mathutils import Vector

rows=[]
for obj in bpy.context.scene.objects:
    if obj.type != 'MESH':
        continue
    mesh=obj.data
    mesh.calc_loop_triangles()
    bad_values=sum(not all(math.isfinite(v) for v in vertex.co) for vertex in mesh.vertices)
    bad_normals=sum(not all(math.isfinite(v) for v in poly.normal) or poly.normal.length < .9 for poly in mesh.polygons)
    degenerate=sum((mesh.vertices[t.vertices[1]].co-mesh.vertices[t.vertices[0]].co).cross(mesh.vertices[t.vertices[2]].co-mesh.vertices[t.vertices[0]].co).length < 1e-12 for t in mesh.loop_triangles)
    rows.append({'name':obj.name,'layer':obj.parent.name if obj.parent else None,'vertices':len(mesh.vertices),'triangles':len(mesh.loop_triangles),'non_finite_vertices':bad_values,'invalid_normals':bad_normals,'degenerate_triangles':degenerate})
report={'blender':bpy.app.version_string,'layers':[o.name for o in bpy.context.scene.objects if o.name.startswith('layer_')],'meshes':rows,'triangles':sum(r['triangles'] for r in rows),'passed':all(r['non_finite_vertices']==r['invalid_normals']==r['degenerate_triangles']==0 for r in rows)}
dest=os.path.join(os.path.dirname(bpy.data.filepath),'mesh-audit.json')
with open(dest,'w') as f:json.dump(report,f,indent=2)
print('MESH_AUDIT',json.dumps({'passed':report['passed'],'meshes':len(rows),'triangles':report['triangles'],'layers':report['layers']}))
