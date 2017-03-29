function main() {
    let canvas = document.getElementById("canvas");
    let params = {
        clearColor: {r: 1, g: 1, b: 1, a: 1}
    };
    let leftTrack = new Float32Array([0, 0, 1, 0, 0]);
    let rightTrack = new Float32Array([0, 0, 1, 0, 0]);
    let inspector = new RoadSurfaceInspector(canvas, leftTrack, rightTrack, params);

    if (inspector.error != null) {
        console.log(inspector.error);
    } else {
        console.log(inspector);
    }
}
