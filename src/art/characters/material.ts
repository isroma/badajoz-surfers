/**
 * The one material every character, the stork and the patinete share: physically based, vertex
 * coloured, with per-vertex roughness (the `rough` attribute) and a soft fresnel rim so the figures
 * separate from busy streets by day and by night. One program per variant (skinned, morphed).
 */
import * as THREE from "three";

function make(): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 });
  const rim = { value: new THREE.Color(0.24, 0.26, 0.31) };
  m.onBeforeCompile = (shader) => {
    shader.uniforms["uRim"] = rim;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nattribute float rough;\nvarying float vRough;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvRough = rough;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying float vRough;\nuniform vec3 uRim;")
      .replace("#include <roughnessmap_fragment>", "#include <roughnessmap_fragment>\nroughnessFactor = clamp(roughnessFactor * vRough, 0.08, 1.0);")
      .replace(
        "#include <opaque_fragment>",
        [
          "float rimF = 1.0 - clamp(dot(normalize(normal), normalize(vViewPosition)), 0.0, 1.0);",
          "outgoingLight += uRim * pow(rimF, 3.0) * (0.45 + 0.55 * diffuseColor.rgb);",
          "#include <opaque_fragment>",
        ].join("\n"),
      );
  };
  m.customProgramCacheKey = () => "badajoz-char-v1";
  m.userData["cast"] = true;
  return m;
}

export const CHAR = make();
