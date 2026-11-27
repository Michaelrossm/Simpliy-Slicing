//! Dreiecksnetz aus STL. Vorschau und 3MF-Export nutzen exakt dieselbe Dreiecksreihenfolge,
//! denn die Bemalung wird pro Dreiecksnummer gespeichert.
use std::collections::HashMap;

pub const MAX_TRIANGLES: usize = 21_500_000;

#[derive(Clone, Debug)]
pub struct Mesh {
    pub vertices: Vec<[f32; 3]>,
    pub triangles: Vec<[u32; 3]>,
}

impl Mesh {
    pub fn from_stl(bytes: &[u8]) -> Result<Mesh, String> {
        let corners = if is_binary(bytes) { binary_corners(bytes)? } else { ascii_corners(bytes)? };
        Self::weld(&corners)
    }

    fn weld(corners: &[[f32; 3]]) -> Result<Mesh, String> {
        let mut index: HashMap<[u32; 3], u32> = HashMap::with_capacity(corners.len() / 5);
        let mut vertices = Vec::new();
        let mut triangles = Vec::with_capacity(corners.len() / 3);
        for face in corners.chunks_exact(3) {
            let mut triangle = [0u32; 3];
            for (slot, point) in triangle.iter_mut().zip(face) {
                if point.iter().any(|v| !v.is_finite()) {
                    return Err("Das Modell enthält ungültige Koordinaten".into());
                }
                // +0.0 macht aus -0.0 eine 0.0, sonst wuerden gleiche Punkte doppelt angelegt.
                let key = point.map(|v| (v + 0.0).to_bits());
                *slot = *index.entry(key).or_insert_with(|| {
                    vertices.push(*point);
                    (vertices.len() - 1) as u32
                });
            }
            // Entartete Dreiecke entfernt die Engine ebenfalls; blieben sie, verschoebe sich die Bemalung.
            let [a, b, c] = triangle;
            if a != b && b != c && a != c {
                triangles.push(triangle);
            }
        }
        if triangles.is_empty() {
            return Err("Das Modell enthält keine Dreiecke".into());
        }
        let mut mesh = Mesh { vertices, triangles };
        mesh.center_on_origin();
        Ok(mesh)
    }

    /// XY-Mitte auf 0, Unterkante auf Z = 0.
    fn center_on_origin(&mut self) {
        let mut low = [f32::INFINITY; 3];
        let mut high = [f32::NEG_INFINITY; 3];
        for v in &self.vertices {
            for axis in 0..3 {
                low[axis] = low[axis].min(v[axis]);
                high[axis] = high[axis].max(v[axis]);
            }
        }
        let offset = [(low[0] + high[0]) / 2.0, (low[1] + high[1]) / 2.0, low[2]];
        for v in &mut self.vertices {
            for axis in 0..3 {
                v[axis] -= offset[axis];
            }
        }
    }

    /// Erkennt, ob die Datei seit dem Bemalen veraendert wurde (FNV-1a).
    pub fn signature(&self) -> u32 {
        let mut hash = 0x811c_9dc5u32;
        let mut feed = |word: u32| hash = (hash ^ word).wrapping_mul(0x0100_0193);
        self.vertices.iter().flatten().for_each(|v| feed(v.to_bits()));
        self.triangles.iter().flatten().for_each(|v| feed(*v));
        hash
    }

    /// Format fuer die Oberflaeche: nv, nt, Signatur (je u32), dann Punkte (f32) und Indizes (u32).
    pub fn to_bytes(&self) -> Vec<u8> {
        let mut out = Vec::with_capacity(12 + (self.vertices.len() + self.triangles.len()) * 12);
        for word in [self.vertices.len() as u32, self.triangles.len() as u32, self.signature()] {
            out.extend_from_slice(&word.to_le_bytes());
        }
        self.vertices.iter().flatten().for_each(|v| out.extend_from_slice(&v.to_le_bytes()));
        self.triangles.iter().flatten().for_each(|v| out.extend_from_slice(&v.to_le_bytes()));
        // Dahinter eine Normale je Dreiecksecke zum Zeichnen.
        let vertices: Vec<f32> = self.vertices.iter().flatten().copied().collect();
        let indices: Vec<u32> = self.triangles.iter().flatten().copied().collect();
        crate::shading::normals(&vertices, &indices).iter().for_each(|v| out.extend_from_slice(&v.to_le_bytes()));
        out
    }
}

fn is_binary(bytes: &[u8]) -> bool {
    if bytes.len() < 84 {
        return false;
    }
    let count = u32::from_le_bytes([bytes[80], bytes[81], bytes[82], bytes[83]]) as u64;
    let expected = 84 + count * 50;
    // Manche Programme schreiben "solid" in den Kopf binaerer Dateien oder haengen Daten an.
    expected == bytes.len() as u64
        || (count > 0 && expected < bytes.len() as u64 && !bytes.starts_with(b"solid"))
}

fn binary_corners(bytes: &[u8]) -> Result<Vec<[f32; 3]>, String> {
    let count = u32::from_le_bytes([bytes[80], bytes[81], bytes[82], bytes[83]]) as usize;
    if count > MAX_TRIANGLES {
        return Err(too_large());
    }
    let mut corners = Vec::with_capacity(count * 3);
    for facet in bytes[84..84 + count * 50].chunks_exact(50) {
        for corner in facet[12..48].chunks_exact(12) {
            let read = |at: usize| f32::from_le_bytes([corner[at], corner[at + 1], corner[at + 2], corner[at + 3]]);
            corners.push([read(0), read(4), read(8)]);
        }
    }
    Ok(corners)
}

fn ascii_corners(bytes: &[u8]) -> Result<Vec<[f32; 3]>, String> {
    let text = String::from_utf8_lossy(bytes);
    let mut corners = Vec::new();
    for line in text.lines() {
        let Some(rest) = line.trim_start().strip_prefix("vertex") else { continue };
        let values: Vec<f32> = rest.split_whitespace().filter_map(|v| v.parse().ok()).collect();
        if values.len() != 3 {
            return Err("STL-Datei ist beschädigt".into());
        }
        corners.push([values[0], values[1], values[2]]);
        if corners.len() > MAX_TRIANGLES * 3 {
            return Err(too_large());
        }
    }
    if corners.len() % 3 != 0 {
        return Err("STL-Datei ist unvollständig".into());
    }
    Ok(corners)
}

fn too_large() -> String {
    format!("Modell zu groß: mehr als {MAX_TRIANGLES} Dreiecke")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn binary(faces: &[[[f32; 3]; 3]]) -> Vec<u8> {
        let mut out = b"solid binary with misleading header".to_vec();
        out.resize(80, 0);
        out.extend_from_slice(&(faces.len() as u32).to_le_bytes());
        for face in faces {
            out.extend_from_slice(&[0; 12]);
            face.iter().flatten().for_each(|v| out.extend_from_slice(&v.to_le_bytes()));
            out.extend_from_slice(&[0; 2]);
        }
        out
    }

    #[test]
    fn welds_centres_and_drops_degenerate_triangles() {
        let a = [10.0, 10.0, 5.0];
        let b = [30.0, 10.0, 5.0];
        let c = [10.0, 30.0, 9.0];
        let mesh = Mesh::from_stl(&binary(&[[a, b, c], [a, a, c], [c, b, a]])).unwrap();
        assert_eq!(mesh.vertices.len(), 3);
        assert_eq!(mesh.triangles.len(), 2);
        assert_eq!(mesh.vertices[0], [-10.0, -10.0, 0.0]);
    }

    #[test]
    fn reads_ascii() {
        let text = "solid x\nfacet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 1 0 0\nvertex 0 1 0\nendloop\nendfacet\nendsolid x";
        assert_eq!(Mesh::from_stl(text.as_bytes()).unwrap().triangles.len(), 1);
    }

    #[test]
    fn rejects_broken_files() {
        assert!(Mesh::from_stl(b"not an stl").is_err());
        assert!(Mesh::from_stl(b"solid x\nvertex 0 0 0\n").is_err());
    }
}
