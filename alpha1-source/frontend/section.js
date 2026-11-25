/** Visual section in world coordinates; it never changes the model or print job. */
export function sectionRange(bed, orientation) {
 const axis=(orientation||'+Z').slice(1).toUpperCase();
 if(axis==='X')return [bed.minX,bed.maxX];
 if(axis==='Y')return [bed.minY,bed.maxY];
 return [0,bed.height];
}
export function sectionPlaneSpec(orientation, position) {
 if(!/^[+-][XYZ]$/.test(orientation)||!Number.isFinite(position))throw Error('Ungueltige Schnittebene');
 const sign=orientation[0]==='+'?1:-1, index={X:0,Y:1,Z:2}[orientation[1]],normal=[0,0,0];normal[index]=sign;
 return {normal,constant:-sign*position,index};
}
export function clampSectionPosition(value, bed, orientation) {
 const [min,max]=sectionRange(bed,orientation);const n=Number(value);return Math.max(min,Math.min(max,Number.isFinite(n)?n:(min+max)/2));
}
