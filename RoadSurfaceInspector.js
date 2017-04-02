/*
 * Road Surface Inspector
 * Source: https://github.com/lragnarsson/Road-Surface-Inspector
 * License: MIT
 */

class RoadSurfaceInspector {
    constructor(canvas, leftTrack, rightTrack, renderCallback, params) {
        this.canvas = canvas;
        this.leftTrack = leftTrack;
        this.rightTrack = rightTrack;
        this.renderCallback = renderCallback;
        this.Ds = params.Ds == null ? 0.5 : params.Ds;
        this.trackWidth = params.trackWidth == null ? 1.55 : params.trackWidth;
        this.laneWidth = params.laneWidth == null ? 3.5 : params.laneWidth;
        this.lengthSubdivisions = params.lengthSubdivisions == null ? 8: params.lengthSubdivisions;
        this.roadBankingAngle = params.roadBankingAngle == null ? 0 : params.roadBankingAngle;
        this.roadGradeAngle = params.roadGradeAngle == null ? 0 : params.roadGradeAngle;
        this.roadRoughness = params.roadRoughness == null ? 0.01 : params.roadRoughness;
        this.backgroundColorTop = params.backgroundColorTop == null ? {r: 0.3, g: 0.5, b: 0.9, a: 1} : params.backgroundColorTop;
        this.backgroundColorBottom = params.backgroundColorBottom == null ? {r: 0.44, g: 0.64, b: 0.95, a: 1} : params.backgroundColorBottom;
        this.forceGL1 = params.forceGL1 == null ? false : params.forceGL1;
        this.orbitSensitivity = params.orbitSensitivity == null ? 1 : params.orbitSensitivity;

        this.error = null;

        if (this.leftTrack.length != this.rightTrack.length) {
            this.error = "Left and right track must be the same length!";
            return;
        }
        if (this.laneWidth <= this.trackWidth) {
            this.error = "Lane width must be larger than track width!";
            return;
        }
        this.roadLength = this.Ds * this.leftTrack.length;

        this.trackWidth = this.Ds * Math.round(this.trackWidth / this.Ds);
        this.laneWidth = this.trackWidth + 2*this.Ds * Math.round((this.laneWidth - this.trackWidth) / (2*this.Ds));
        this.DsOut = this.Ds / this.lengthSubdivisions;

        this.drag = false;
        this.mouseDX = 0;
        this.mouseDY = 0;
        this.theta = Math.PI / 2;
        this.phi = Math.PI / 4;
        this.mouseOldX = 0;
        this.mouseOldY = 0;

        this.camOrbitRadius = 5;
        this.camPos = [-2, 1, -2];
        this.camUp = [0, 1, 0];
        this.camPOI = [0, 0, 0];
        this.camQuaternion = []

        this.sourceGrid = null;
        this.biCubicGrid = null;
        this.surfaceVertices = null;
        this.surfaceIndices = null;
        this.surfaceNormals = null;

        if (!this._initGLContext()) {
            return;
        }

        // Define attribute locations:
        this.VX_BUF = 0;
        this.NM_BUF = 1;

        if (!this._initShaders()) {
            return;
        }

        this._generateSurfaceGrid();
        this._generateSurfaceTriangles();

        this._initBackground();

        this._initUniforms();

        this.boundDraw = e => this.draw();
        this.boundMouseDown = e => this._mouseDown(e);
        this.boundMouseUp = e => this._mouseUp(e);
        this.boundMouseMove = e => this._mouseMove(e);
        this.boundMouseWheel = e => this._mouseWheel(e);

        this.canvas.addEventListener("mousedown", this.boundMouseDown, false);
        this.canvas.addEventListener("mouseup", this.boundMouseUp, false);
        this.canvas.addEventListener("mouseout", this.boundMouseUp, false);
        this.canvas.addEventListener("mousemove", this.boundMouseMove, false);
        this.canvas.addEventListener("mousewheel", this.boundMouseWheel, false);
        this.canvas.addEventListener("DOMMouseScroll", this.boundMouseWheel, false); // Firefox Hipsters

        this.draw();
    }


    _initGLContext() {
        this.GL = null;
        this.GLVersion = null;
        if (!this.forceGL1) {
            // Attempt to get a WebGL 2 context:
            try {
                this.GL = this.canvas.getContext("webgl2");
                this.GLVersion = 2;
            } catch(e) {
                console.log("Could not create a WebGL2 context.");
            }
        }

        // Fallback to WebGL 1:
        if (!this.GL) {
            try {
                this.GL = this.canvas.getContext("webgl");
                this.GLVersion = 1;
            } catch(e) {
                console.log("Could not create a WebGL1 context.");
            }
        }

        // Fallback to WebGL experimental (Internet explorer):
        if (!this.GL) {
            try {
                this.GL = this.canvas.getContext("experimental-webgl");
                this.GLVersion = 1;
            } catch(e) {
                console.log("Could not create an experimental-WebGL1 context.");
            }
        }

        if (!this.GL) {
            // Could not get anything
            this.error = "Could not initialize a WebGL context.";
            return false;
        }

        this.GL.clearColor(0.6, 0.6, 0.65, 1);
        this.GL.viewport(0, 0, this.canvas.width, this.canvas.height);
        return true;
    }


    _initArrayBuffer(data, bufferType) {
        let buffer = this.GL.createBuffer();
        this.GL.bindBuffer(bufferType, buffer);
        this.GL.bufferData(bufferType, data, this.GL.STATIC_DRAW);
        return buffer;
    }


    _initUniforms() {
        const aspectRatio = this.canvas.width/this.canvas.height;
        const fovY = 45;
        const near = 1;
        const far = 1000;
        const projection = this._projection(fovY, aspectRatio, near, far);

        // Surface shader uniforms:
        this.GL.useProgram(this.surfaceProgram);
        let projLoc = this.GL.getUniformLocation(this.surfaceProgram, 'projection');
        this.GL.uniformMatrix4fv(projLoc, false, projection);

        let model = this._translate([-this.roadLength/2, 0, -this.laneWidth/2]);
        let modelLoc = this.GL.getUniformLocation(this.surfaceProgram, 'model');
        this.GL.uniformMatrix4fv(modelLoc, false, model);

        this._updateCam();

        // Background shader uniforms:
        this.GL.useProgram(this.backgroundProgram);

        let bgProjLoc = this.GL.getUniformLocation(this.backgroundProgram, 'projection');
        this.GL.uniformMatrix4fv(bgProjLoc, false, projection);

        let bModel = this._translate(this.camPos);
        let bModelLoc = this.GL.getUniformLocation(this.backgroundProgram, 'model');
        this.GL.uniformMatrix4fv(bModelLoc, false, bModel);

        let topLoc = this.GL.getUniformLocation(this.backgroundProgram, 'colorTop');
        this.GL.uniform4fv(topLoc, new Float32Array([
        this.backgroundColorTop.r, this.backgroundColorTop.g, this.backgroundColorTop.b, 1]));

        let bottomLoc = this.GL.getUniformLocation(this.backgroundProgram, 'colorBottom');
        this.GL.uniform4fv(bottomLoc, new Float32Array([
        this.backgroundColorBottom.r, this.backgroundColorBottom.g, this.backgroundColorBottom.b, 1]));
    }


    _initBackground() {
    let backgroundVertices = new Float32Array([
        // Front
        -1.0, -1.0,  1.0,
        1.0, -1.0,  1.0,
        1.0,  1.0,  1.0,
        -1.0,  1.0,  1.0,
        // Back
        -1.0, -1.0, -1.0,
        -1.0,  1.0, -1.0,
        1.0,  1.0, -1.0,
        1.0, -1.0, -1.0,
        // Top
        -1.0,  1.0, -1.0,
        -1.0,  1.0,  1.0,
        1.0,  1.0,  1.0,
        1.0,  1.0, -1.0,
        // Bottom
        -1.0, -1.0, -1.0,
        1.0, -1.0, -1.0,
        1.0, -1.0,  1.0,
        -1.0, -1.0,  1.0,
        // Right
        1.0, -1.0, -1.0,
        1.0,  1.0, -1.0,
        1.0,  1.0,  1.0,
        1.0, -1.0,  1.0,
        // Left
        -1.0, -1.0, -1.0,
        -1.0, -1.0,  1.0,
        -1.0,  1.0,  1.0,
        -1.0,  1.0, -1.0,
    ]);

    let backgroundIndices = new Uint16Array([
        0, 1, 2,      0, 2, 3,    // Front
        4, 5, 6,      4, 6, 7,    // Back
        8, 9, 10,     8, 10, 11,  // Top
        12, 13, 14,   12, 14, 15, // Bottom
        16, 17, 18,   16, 18, 19, // Right
        20, 21, 22,   20, 22, 23  // Left
    ]);

        this.GL.useProgram(this.backgroundProgram);
        this.backgroundIndexBuffer = this._initArrayBuffer(backgroundIndices, this.GL.ELEMENT_ARRAY_BUFFER);
        this.backgroundVertexBuffer = this._initArrayBuffer(backgroundVertices, this.GL.ARRAY_BUFFER);
        this.backgroundIndexSize = backgroundIndices.length;
    }


    updateCanvasSize(width, height) {
        this.canvas.width = width;
        this.canvas.height = height;
        this._initUniforms();
    }


    _generateSurfaceGrid() {
        //const L = this.roadLength;
        const TW = this.trackWidth;
        const LW = this.laneWidth;
        //const OW = (LW - TW) / 2; 
        const LSD = this.lengthSubdivisions;

        const inN = this.leftTrack.length;
        const inM = 2 + Math.round((LW - TW) / this.Ds);

        const N = (inN - 1) * LSD + 1;
        const outerM = (inM-2) * LSD;
        const inInnerM = TW / this.Ds + 1;
        const innerM = (inInnerM - 1) * LSD + 1;
        const M = outerM + innerM;

        const lTrackIn = (inM-2) / 2 + 1;
        const rTrackIn = lTrackIn + 1;
        const lTrack = outerM / 2+1;
        const rTrack = M - outerM / 2;

        const smallStep = 2;
        const largeStep = inInnerM+1;

        /*
        console.log("inN: " + inN);
        console.log("inM: " + inM);
        console.log("lTrackIn: " + lTrackIn);
        console.log("rTrackIn: " + rTrackIn);
        console.log("N: " + N);
        console.log("M: " + M);
        console.log("outerM: " + outerM);
        console.log("innerM: " + innerM);       
        console.log("inInnerM: " + inInnerM); 
        console.log("lTrack: " + lTrack);
        console.log("rTrack: " + rTrack);*/

        // Initialize height grid with zeros:
        this.sourceGrid = new Array(inN+3);
        for (let i=0; i<inN+3; i++) {
            this.sourceGrid[i] = new Float32Array(inM+3);
        }

        // Insert input track values in height grid:
        for (let i=0; i<inN; i++) {
            this.sourceGrid[i+1][lTrackIn] = this.leftTrack[i];
            this.sourceGrid[i+1][lTrackIn-1] = this.leftTrack[i];
            this.sourceGrid[i+1][rTrackIn] = this.rightTrack[i];
            this.sourceGrid[i+1][rTrackIn+1] = this.rightTrack[i];
        }
        //console.log(this.sourceGrid);

        // Initialize output height grid:
        this.biCubicGrid = new Array(N+3);
        for (let i=0; i<N+3; i++) {
            this.biCubicGrid[i] = new Float32Array(M+3);
        }

        //console.log(this.biCubicGrid);
        let subI = 0;
        let subJ = 0;
        let interpX = 0;
        let interpY = 0;
        let sourceI = 0;
        let sourceJ = 0;
        let curStep1 = smallStep;
        let curStep2 = smallStep;

        for (let i=1; i<N+1; i++) {
            subI = ((i-1) % LSD);
            sourceI = 1+((i-1) - subI) / LSD;
            interpX = subI / LSD;
            //console.log(sourceI);
            for (let j=1; j<M+1; j++) {
                if (j == lTrack) {
                    curStep1 = smallStep;
                    curStep2 = largeStep;
                } else if (j == rTrack) {
                    curStep1 = largeStep;
                    curStep2 = smallStep;
                } else {
                    curStep1 = smallStep;
                    curStep2 = smallStep;
                }

                if (j >= lTrack && j < rTrack) {
                    curStep1 = largeStep;
                    curStep2 = largeStep;
                    sourceJ = lTrackIn;
                    interpY = (j - rTrack + innerM) / (innerM);
                } else if (j >= rTrack) {
                    subJ = ((j-1) % LSD);
                    sourceJ = 1+((j-1) - subJ) / LSD - (inInnerM - 2);
                    interpY = subJ / LSD;
                } else {
                    subJ = ((j-1) % LSD);
                    sourceJ = 1+((j-1) - subJ) / LSD;
                    interpY = subJ / LSD;
                }                
                //console.log(interpY);
                //console.log(sourceI);

                this.biCubicGrid[i][j] = this._interpBiCubic(interpX, interpY, sourceI, sourceJ, smallStep, curStep1, curStep2);
            }
        }
        //console.log(this.biCubicGrid);
    }


    _interpBiCubic(x, y, i, j, longStep, latStep1, latStep2) {
        //console.log(this.sourceGrid);
        return this._interpCubic(y,
            this._interpCubic(x, this.sourceGrid[i-1][j-1], this.sourceGrid[i][j-1], this.sourceGrid[i+1][j-1], this.sourceGrid[i+2][j-1], longStep, longStep),
            this._interpCubic(x, this.sourceGrid[i-1][j  ], this.sourceGrid[i][j  ], this.sourceGrid[i+1][j  ], this.sourceGrid[i+2][j  ], longStep, longStep),
            this._interpCubic(x, this.sourceGrid[i-1][j+1], this.sourceGrid[i][j+1], this.sourceGrid[i+1][j+1], this.sourceGrid[i+2][j+1], longStep, longStep),
            this._interpCubic(x, this.sourceGrid[i-1][j+2], this.sourceGrid[i][j+2], this.sourceGrid[i+1][j+2], this.sourceGrid[i+2][j+2], longStep, longStep),
            latStep1, latStep2);
    }


    _interpCubic(x, p0, p1, p2, p3, step1, step2) {
        // f (x) = ax^3 + bx^2 + cx + d
        // f'(x) = 3ax^2 + 2bx + c
        let f0 = p1;
        let f1 = p2;
        // Different step length for numerical derivatives:
        let df0 = (p2 - p0) / step1; 
        let df1 = (p3 - p1) / step2;
        let a = 2.0*f0 - 2.0*f1 + df0 + df1;
        let b = -3.0*f0 + 3.0*f1 - 2.0*df0 - df1;
        let c = df0;
        let d = f0;
        return a * Math.pow(x, 3) + b * Math.pow(x, 2) + c * x + d;
        //return (c - a + (2.0*a - 5.0*b + 4.0*c - d + (3.0*(b - c) + d - a)*interp)*interp)*interp/step + b;
    }


    _generateSurfaceTriangles() {
        const N = this.biCubicGrid.length; 
        const M = this.biCubicGrid[0].length;
        const numTriangles = (N-1) * (M-1) * 2;
        const LSD = this.lengthSubdivisions

        this.surfaceVertices = new Float32Array(N * M * 3);
        this.surfaceIndices = new Uint16Array(numTriangles * 3);
        this.surfaceNormals = new Float32Array(N * M * 3);

        for (let x=0; x<N; x++) {
            for(let z=0; z<M; z++) {
                this.surfaceVertices[(x + z * N)*3 + 0] = x * this.DsOut;
                this.surfaceVertices[(x + z * N)*3 + 1] = this.biCubicGrid[x][z] + this.roadRoughness * (Math.random() * 2 - 1) / LSD;
                this.surfaceVertices[(x + z * N)*3 + 2] = z * this.DsOut;
            }
        }

        for (let x=0; x<N-1; x++) {
            for(let z=0; z<M-1; z++) {
                let ax = (x + z * N)*3;
                let a = [this.surfaceVertices[ax+0], this.surfaceVertices[ax+1], this.surfaceVertices[ax+2]];
                let bx = (x + (z+1) * N)*3;
                let b = [this.surfaceVertices[bx+0], this.surfaceVertices[bx+1], this.surfaceVertices[bx+2]];
                let cx = (x+1 + z * N)*3;
                let c = [this.surfaceVertices[cx+0], this.surfaceVertices[cx+1], this.surfaceVertices[cx+2]];
                let dx = (x+1 + (z+1) * N)*3;
                let d = [this.surfaceVertices[dx+0], this.surfaceVertices[dx+1], this.surfaceVertices[dx+2]];

                let normal1 = this._cross(
                    this._vecSub(b, a),
                    this._vecSub(c, a));

                let normal2 = this._cross(
                    this._vecSub(b, c),
                    this._vecSub(d, c));

                this.surfaceNormals[ax+0] = normal1[0];
                this.surfaceNormals[ax+1] = normal1[1];
                this.surfaceNormals[ax+2] = normal1[2];

                this.surfaceNormals[bx+0] = 0.5*(normal1[0]+normal2[0]);
                this.surfaceNormals[bx+1] = 0.5*(normal1[1]+normal2[1]);
                this.surfaceNormals[bx+2] = 0.5*(normal1[2]+normal2[2]);

                this.surfaceNormals[cx+0] = 0.5*(normal1[0]+normal2[0]);
                this.surfaceNormals[cx+1] = 0.5*(normal1[1]+normal2[1]);
                this.surfaceNormals[cx+2] = 0.5*(normal1[2]+normal2[2]);

                this.surfaceNormals[dx+0] = normal2[0];
                this.surfaceNormals[dx+1] = normal2[1];
                this.surfaceNormals[dx+2] = normal2[2];
            }
        }

        for (let x=0; x<N - 1; x++) {
            for(let z=0; z<M - 1; z++) {
                // First triangle:
                this.surfaceIndices[(x + z * (N-1))*6 + 0] = x + z * N;
                this.surfaceIndices[(x + z * (N-1))*6 + 1] = x + (z+1) * N;
                this.surfaceIndices[(x + z * (N-1))*6 + 2] = (x+1) + z * N;
                // Second Triangle:
                this.surfaceIndices[(x + z * (N-1))*6 + 3] = (x+1) + z * N;
                this.surfaceIndices[(x + z * (N-1))*6 + 4] = x + (z+1) * N;
                this.surfaceIndices[(x + z * (N-1))*6 + 5] = (x+1) + (z+1) * N;
            }
        }

        this.GL.useProgram(this.surfaceProgram);
        this.surfaceIndexBuffer = this._initArrayBuffer(this.surfaceIndices, this.GL.ELEMENT_ARRAY_BUFFER);
        this.surfaceVertexBuffer = this._initArrayBuffer(this.surfaceVertices, this.GL.ARRAY_BUFFER);
        this.surfaceNormalBuffer = this._initArrayBuffer(this.surfaceNormals, this.GL.ARRAY_BUFFER);

        this.surfaceIndexSize = this.surfaceIndices.length;

    }


    draw() {
        // Clear screen:
        this.GL.clear(this.GL.COLOR_BUFFER_BIT);

        if (this.GLVersion == 2) {
            this._drawBackgroundGL2();
            this._drawSurfaceGL2();
        } else if (this.GLVersion == 1) {
            this._drawBackgroundGL1();
            this._drawSurfaceGL1();
        }
        let keepGoing = this.renderCallback();
        if (keepGoing) {
            requestAnimationFrame(this.boundDraw);
        }
    }


    _drawSurfaceGL2() {
        this.GL.useProgram(this.surfaceProgram);
        this.GL.enable(this.GL.DEPTH_TEST);

        this.GL.enableVertexAttribArray(this.VX_BUF);
        this.GL.bindBuffer(this.GL.ARRAY_BUFFER, this.surfaceVertexBuffer);
        this.GL.vertexAttribPointer(this.VX_BUF, 3, this.GL.FLOAT, false, 0, 0);

        this.GL.enableVertexAttribArray(this.NM_BUF);
        this.GL.bindBuffer(this.GL.ARRAY_BUFFER, this.surfaceNormalBuffer);
        this.GL.vertexAttribPointer(this.NM_BUF, 3, this.GL.FLOAT, false, 0, 0);

        this.GL.bindBuffer(this.GL.ELEMENT_ARRAY_BUFFER, this.surfaceIndexBuffer);
        this.GL.drawElements(this.GL.TRIANGLES, this.surfaceIndexSize, this.GL.UNSIGNED_SHORT, 0);
    }


    _drawSurfaceGL1() {
        this._drawSurfaceGL2();
    }


    _drawBackgroundGL2() {
        this.GL.useProgram(this.backgroundProgram);
        this.GL.disable(this.GL.DEPTH_TEST);

        this.GL.enableVertexAttribArray(this.VX_BUF);
        this.GL.bindBuffer(this.GL.ARRAY_BUFFER, this.backgroundVertexBuffer);
        this.GL.vertexAttribPointer(this.VX_BUF, 3, this.GL.FLOAT, false, 0, 0);

        this.GL.bindBuffer(this.GL.ELEMENT_ARRAY_BUFFER, this.backgroundIndexBuffer);
        this.GL.drawElements(this.GL.TRIANGLES, this.backgroundIndexSize, this.GL.UNSIGNED_SHORT, 0);
    }


    _drawBackgroundGL1() {
        this._drawBackgroundGL2();
    }


    _mouseDown(e) {
        this.drag = true;
        this.mouseOldX = e.pageX;
        this.mouseOldY = e.pageY;
        e.preventDefault();
        return false;
    }


    _mouseUp(e) {
        this.drag = false;
    }


    _mouseMove(e) {
        if (!this.drag) {
            return false;
        }

        this.mouseDX = (e.pageX - this.mouseOldX) * 2*Math.PI / this.canvas.width,
        this.mouseDY = (e.pageY - this.mouseOldY) * 2*Math.PI / this.canvas.height;

        let newPhi = this.phi + this.orbitSensitivity * this.mouseDY;
        if (Math.abs(newPhi) < Math.PI / 3) {
            this.phi = newPhi;
        }
        this.theta += this.orbitSensitivity * this.mouseDX;
        this.mouseOldX = e.pageX;
        this.mouseOldY = e.pageY;

        this._updateCam();
        
        e.preventDefault();
        return true;
    }


    _mouseWheel(e) {
        var delta = e.wheelDelta ? -e.wheelDelta : e.detail;
        delta = this.orbitSensitivity * delta / 100;
        let newOrbit = this.camOrbitRadius + delta;
        if (newOrbit > 1.0 && newOrbit < 30.0) {
            this.camOrbitRadius = newOrbit;
            this._updateCam();
        }
    }


    _updateCam() {
        this.camPos[0] = this.camOrbitRadius * Math.cos(this.phi) * Math.sin(this.theta);
        this.camPos[1] = this.camOrbitRadius * Math.sin(this.phi) * Math.sin(this.theta);
        this.camPos[2] = this.camOrbitRadius * Math.cos(this.theta);

        let viewDir = this._vecSub(this.camPOI, this.camPos);
        this.GL.useProgram(this.surfaceProgram);

        this.viewMat = this._lookAt(this.camPos, this.camPOI, this.camUp);
        let viewLoc = this.GL.getUniformLocation(this.surfaceProgram, 'view');
        this.GL.uniformMatrix4fv(viewLoc, false, this.viewMat);
        let viewDirLoc = this.GL.getUniformLocation(this.surfaceProgram, 'viewDir');
        this.GL.uniform3fv(viewDirLoc, new Float32Array(viewDir));

        this.GL.useProgram(this.backgroundProgram);
        let skyViewMat = this._lookAt([0,0,0], viewDir, this.camUp);
        let skyViewLoc = this.GL.getUniformLocation(this.backgroundProgram, 'view');
        this.GL.uniformMatrix4fv(skyViewLoc, false, skyViewMat);
}


    _createShaderProgram(vertexSource, fragmentSource) {
        let vertexShader = this._compileShader(vertexSource, this.GL.VERTEX_SHADER);
        let fragmentShader = this._compileShader(fragmentSource, this.GL.FRAGMENT_SHADER);
        if (!vertexShader || ! fragmentShader) {
            return false;
        }

        let program = this.GL.createProgram();

        // Bind attribute locations
        this.GL.bindAttribLocation(program, this.VX_BUF, 'vertexPos');
        this.GL.attachShader(program, vertexShader);
        this.GL.attachShader(program, fragmentShader);
        this.GL.linkProgram(program);

        if (!this.GL.getProgramParameter(program, this.GL.LINK_STATUS)) {
            this.error = "Could not link shaders: " + this.GL.getProgramInfoLog(program);
            return false;
        }
        return program;
    }


    _compileShader(shaderSource, shaderType) {
        let shader = this.GL.createShader(shaderType);
        this.GL.shaderSource(shader, shaderSource);
        this.GL.compileShader(shader);

        if (!this.GL.getShaderParameter(shader, this.GL.COMPILE_STATUS)) {
            console.log(shaderSource);
            this.error = "Could not compile shader: " + this.GL.getShaderInfoLog(shader);
            return null;
        }
        return shader;
    }


    _initShaders() {
        // Shader source code based on WebGL version:
        let surfaceVertexSource = null;
        let surfaceFragSource = null;
        let backgroundVertexSource = null;
        let backgroundFragSource = null;

        if (this.GLVersion == 2) {
            surfaceVertexSource = `#version 300 es
                                precision highp float;
                                layout(location = 0) in vec3 vertexPos;
                                layout(location = 1) in vec3 vertexNormal;

                                out vec3 position;
                                out vec3 normal;

                                uniform mat4 model;
                                uniform mat4 view;
                                uniform mat4 projection;

                                void main(void) {
                                    position = vertexPos;
                                    normal = normalize(vertexNormal); // TODO : Model Rotation
                                    gl_Position =  projection * view * model * vec4(vertexPos, 1.0);
                                }`;

            surfaceFragSource = `#version 300 es
                                precision highp float;

                                in vec3 position;
                                in vec3 normal;
                                in vec3 vBC;

                                out vec4 fragmentColor;

                                uniform vec3 viewDir;

                                void main(void) {
                                    const float shininess = 50.0;
                                    const vec3 lightPos = vec3(10.0, 10.0, 15.0);
                                    vec3 lightDir = normalize(lightPos - position);

                                    float height_color = pow(3.0*abs(position.y), 1.8);
                                    vec3 color = vec3(0.9);
                                    if (position.y >= 0.0) {
                                        color = color + vec3(-0.5*height_color, 0.5*height_color, height_color) * color;
                                    } else {
                                        color = color + vec3(height_color, -0.35*height_color, -0.5*height_color) * color;
                                    }

                                    vec3 ambient = 0.1 * color;

                                    float lambertian = max(dot(lightDir, normal), 0.0);
                                    float s = 0.0;                                    

                                    vec3 diffuse = lambertian * color;
                                    
                                    if (lambertian > 0.0) {
                                        //vec3 viewDir = normalize(-position);
                                        vec3 halfDir = normalize(lightDir - normalize(viewDir));
                                        float specAngle = max(dot(halfDir, normal), 0.0);
                                        s = 0.2*pow(specAngle, shininess);
                                    }
                                    vec3 specular = s * color;

                                    fragmentColor = vec4(ambient + diffuse + specular, 1);
                                }`;


            backgroundVertexSource = `#version 300 es
                                precision highp float;
                                layout(location = 0) in vec3 vertexPos;

                                out vec3 skyPos;

                                uniform mat4 view;
                                uniform mat4 projection;

                                void main(void) {
                                    skyPos = vec3(vertexPos);
                                    
                                    gl_Position =  projection * view * vec4(vertexPos, 1.0);
                                    
                                }`;

            backgroundFragSource = `#version 300 es
                                precision highp float;

                                in vec3 skyPos;
                                out vec4 fragmentColor;

                                uniform vec4 colorTop;
                                uniform vec4 colorBottom;

                                void main(void) {
                                    vec3 unitPos = normalize(skyPos);

                                    float height = pow(1.0 * abs(unitPos.y + 0.08), 0.7);
                                    fragmentColor = mix(colorBottom, colorTop, height);
                                }`;


        } else if (this.GLVersion == 1 && false) {
            surfaceVertexSource = `#version 100
                                precision highp float;

                                attribute vec3 vertexPos;

                                uniform mat4 model;
                                uniform mat4 view;
                                uniform mat4 projection;

                                void main(void) {
                                    gl_Position = projection * view * model * vec4(vertexPos, 1.0);
                                }`;

            surfaceFragSource = `#version 100
                          precision highp float;
                          varying vec4 color;

                          void main(void) {
                            gl_FragColor = vec4(1, 1, 0, 1);
                          }`;



            surfaceVertexSource = `#version 100
                                precision highp float;

                                attribute vec3 vertexPos;

                                uniform mat4 model;
                                uniform mat4 view;
                                uniform mat4 projection;

                                void main(void) {
                                    gl_Position = projection * view * model * vec4(vertexPos, 1.0);
                                }`;

            surfaceFragSource = `#version 100
                          precision highp float;

                          void main(void) {
                            gl_FragColor = vec4(1, 1, 0, 1);
                          }`;
        }


        this.surfaceProgram = this._createShaderProgram(surfaceVertexSource, surfaceFragSource, 'surface');
        this.backgroundProgram = this._createShaderProgram(backgroundVertexSource, backgroundFragSource, 'background');
        return (this.surfaceProgram != false && this.backgroundProgram != false);
    }


    /* 
     * -------------- Naive Math Utilities Inc. ----------------
     * vec3 and mat4 utils.
     * Note that all matrices are defined in column-major order!
     * ---------------------------------------------------------
     */


     _dot(u, v) {
        return u[0]*v[0] + u[1]*v[1] + u[2]*v[2];
     }


     _cross(u, v) {
        return [
            u[1]*v[2] - u[2]*v[1],
            u[2]*v[0] - u[0]*v[2],
            u[0]*v[1] - u[1]*v[0]];
     }


     _vecNorm(u) {
        return Math.sqrt(u[0]*u[0] + u[1]*u[1] + u[2]*u[2]);
     }


     _vecAdd(u, v) {
        return [u[0]+v[0], u[1]+v[1], u[2]+v[2]];
     }


     _vecSub(u, v) {
        return [u[0]-v[0], u[1]-v[1], u[2]-v[2]];
     }


     _vecScale(u, a) {
        return [a*u[0], a*u[1], a*u[2]];
     }


     _normalize(u) {
        let norm = this._vecNorm(u);
        if (norm < 0.00001) return [0, 0, 0];
        return this._vecScale(u, 1/norm);
     }


    _translate(t) {
        return new Float32Array([
            1, 0, 0, 0,
            0, 1, 0, 0,
            0, 0, 1, 0,
            t[0], t[1], t[2], 1]);
    }


    _scale(s) {
        return new Float32Array([
            s[0], 0, 0, 0,
            0, s[1], 0, 0,
            0, 0, s[2], 0,
            0, 0, 0, 1]);
    }


    _rotate(a, v, m2) {
        // TODO
    }


    _projection(yFov, aspectRatio, near, far) {
        let tanFovY = Math.tan(yFov / 2);
        return new Float32Array([1 / (aspectRatio * tanFovY), 0, 0, 0,
                                 0, 1 / tanFovY, 0, 0,
                                 0, 0, -(far + near) / (far - near), -(2 * far * near) / (far - near),
                                 0, 0, -1, 0]); 
    }


    _lookAt(pos, target, up) {
        let z = this._normalize(this._vecSub(pos, target));
        let x = this._normalize(this._cross(up, z));
        let y = this._normalize(this._cross(z, x));

        return new Float32Array([
            x[0], y[0], z[0], 0,
            x[1], y[1], z[1], 0,
            x[2], y[2], z[2], 0,
            -this._dot(x, pos), -this._dot(y, pos), -this._dot(z, pos), 1
            ]);
    }


    _eye4() {
        return new Float32Array([
            1, 0, 0, 0,
            0, 1, 0, 0,
            0, 0, 1, 0,
            0, 0, 0, 1]);
    }

}
