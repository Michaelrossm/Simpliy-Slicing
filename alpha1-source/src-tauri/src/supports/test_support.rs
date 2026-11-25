//! Testkoerper aus Quadern [Breite, Tiefe, Hoehe, Mitte x, y, z].
use super::generate::World;

pub fn box_mesh(boxes: &[[f64; 6]]) -> (Vec<f64>, Vec<u32>) {
    const FACES: [usize; 36] = [
        0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 1, 2, 6, 1, 6, 5, 2, 3, 7, 2, 7, 6, 3, 0, 4, 3, 4, 7,
    ];
    let mut vertices = Vec::new();
    for &[w, d, h, x, y, z] in boxes {
        let (a, b, c) = (x - w / 2.0, y - d / 2.0, z - h / 2.0);
        let (e, f, g) = (x + w / 2.0, y + d / 2.0, z + h / 2.0);
        let corners = [[a, b, c], [e, b, c], [e, f, c], [a, f, c], [a, b, g], [e, b, g], [e, f, g], [a, f, g]];
        for corner in FACES {
            vertices.extend(corners[corner]);
        }
    }
    let indices = (0..(vertices.len() / 3) as u32).collect();
    (vertices, indices)
}

pub fn boxes(list: &[[f64; 6]]) -> World {
    let (vertices, indices) = box_mesh(list);
    World::new(vertices, indices)
}
