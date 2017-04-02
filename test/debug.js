function main() {
    let canvas = document.getElementById("canvas");
    let params = {
        clearColor: {r: 1, g: 1, b: 1, a: 1}
    };
    let leftTrack = [0, 0.03, 0, 0, 0, 0.02, 0.2, 0.03, 0, 0, -0.06, 0, -0.12, -0.02, -0.08, 0.01, 0];
    let rightTrack = [0, 0, -0.02, 0, 0, 0.05, 0.22, 0.02, 0, 0, 0.02, 0, 0, 0.03, 0, 0.03, 0];
    
    //let leftTrack = [0, 1, 0];
    //let rightTrack = [0, 0, 0];

    let renderCallback = function() {return true;};
    let inspector = new RoadSurfaceInspector(canvas, leftTrack, rightTrack, renderCallback, params);

    if (inspector.error != null) {
        console.log(inspector.error);
    } else {
        console.log(inspector);
    }
}
