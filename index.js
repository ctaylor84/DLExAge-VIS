import '@kitware/vtk.js/Rendering/Profiles/Volume';
import '@kitware/vtk.js/Rendering/Profiles/Geometry';

import vtkColorTransferFunction from '@kitware/vtk.js/Rendering/Core/ColorTransferFunction';
import vtkDataArray from '@kitware/vtk.js/Common/Core/DataArray';
import vtkFullScreenRenderWindow from '@kitware/vtk.js/Rendering/Misc/FullScreenRenderWindow';
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import vtkLookupTable from '@kitware/vtk.js/Common/Core/LookupTable';
import vtkPiecewiseFunction from '@kitware/vtk.js/Common/DataModel/PiecewiseFunction';
import vtkVolume from '@kitware/vtk.js/Rendering/Core/Volume';
import vtkVolumeMapper from '@kitware/vtk.js/Rendering/Core/VolumeMapper';
import vtkPolyData from '@kitware/vtk.js/Common/DataModel/PolyData';
import vtkPolyDataNormals from '@kitware/vtk.js/Filters/Core/PolyDataNormals';
import vtkMapper from '@kitware/vtk.js/Rendering/Core/Mapper';
import vtkScalarBarActor from '@kitware/vtk.js/Rendering/Core/ScalarBarActor';
import vtkSTLReader from '@kitware/vtk.js/IO/Geometry/STLReader';
import vtkActor from '@kitware/vtk.js/Rendering/Core/Actor';
import vtkVectorText from '@kitware/vtk.js/Rendering/Core/VectorText';
import { BlendMode } from '@kitware/vtk.js/Rendering/Core/VolumeMapper/Constants';
import npyjs from 'npyjs';
import Delaunator from 'delaunator';
import * as opentype from 'opentype.js';
import earcut from 'earcut';

import controlPanel from './controlPanel.html';

const WIREFRAME_SEGMENTS = 14;
const WIREFRAME_RESOLUTION = 48;
const WIREFRAME_OPACITY = 0.5;
const WIREFRAME_WIDTH = 3;

const LAYER_NAMES = [
    '',
    'Inner limiting membrane',
    '',
    '',
    '',
    'Inner border of the outer nuclear layer',
    '',
    'Inner border of the ellipsoid line',
    '',
    "Outer border of the Bruch's membrane",
];
const LAYER_INDICES = [1, 5, 7, 9];
const LAYER_COLORS = {
    1: [0, 0, 1], // blue
    5: [0, 1, 0], // green
    7: [1, 0.647, 0], // orange
    9: [0.5, 0, 0.5], // purple
};

const MODEL_FILES = [
    './data/Lens_Pupil.stl',
    './data/Retina_Optic_Disk.stl',
    './data/Chloroid_Cilliary_Body_Suspensory_Ligaments.stl',
    './data/Iris.stl',
    './data/Sclera.stl',
];

const MODEL_COLORS = [
    [0, 0, 0], // black
    [0.88, 0.64, 0.375], // orange
    [1, 0.502, 0.482], // pink
    [0, 0, 1], // blue
    [1, 1, 1], // white
];

const FONT_URL = 'https://fonts.gstatic.com/s/roboto/v15/zN7GBFwfMP4uA6AR0HCoLQ.ttf'; // Roboto
// const FONT_URL = 'https://fonts.gstatic.com/s/opensans/v10/IgZJs4-7SA1XX_edsoXWog.ttf' // OpenSans

function createHeatmapVolume(attr, maxAttr) {
    const imageData = vtkImageData.newInstance();
    imageData.setExtent(0, attr.shape[0] - 1, 0, attr.shape[1] - 1, 0, attr.shape[2] - 1);
    const dataArray = vtkDataArray.newInstance({
        numberOfComponents: 1,
        values: attr.data,
    });
    imageData.getPointData().setScalars(dataArray);

    const actor = vtkVolume.newInstance();
    const mapper = vtkVolumeMapper.newInstance();
    mapper.setSampleDistance(0.7);
    actor.setMapper(mapper);
    mapper.setInputData(imageData);
    mapper.setBlendMode(BlendMode.MAXIMUM_INTENSITY_BLEND);

    const ctfun = vtkColorTransferFunction.newInstance();
    ctfun.addRGBPoint(0, 0, 0, 0); // base
    ctfun.addRGBPoint(maxAttr, 1, 0, 0); // red
    const ofun = vtkPiecewiseFunction.newInstance();
    ofun.addPoint(0, 0.0);
    ofun.addPoint(maxAttr * 0.1, 0.0);
    ofun.addPoint(maxAttr * 0.25, 0.5);
    ofun.addPoint(maxAttr * 0.3, 0.9);
    ofun.addPoint(maxAttr, 1.0);

    const actorProperty = actor.getProperty();
    actorProperty.setRGBTransferFunction(0, ctfun);
    actorProperty.setScalarOpacity(0, ofun);
    actorProperty.setScalarOpacityUnitDistance(0, 3.0);
    actorProperty.setInterpolationTypeToLinear();
    return actor;
}

function linspace(start, stop, num, endpoint = true) {
    const div = endpoint ? (num - 1) : num;
    const step = (stop - start) / div;
    return Array.from({length: num}, (_, i) => Math.round(start + step * i));
}

function createWireframe(layers) {
    const pointsPerSegment = 2;
    const layerActors = {};
    for (const j of LAYER_INDICES) {
        const allPoints = [];
        const allLines = [];
        let pointOffset = 0;

        for (const dir_i of [0, 1]) { // x to z, and z to x
            for (const i of linspace(0, layers.shape[dir_i] - 1, WIREFRAME_SEGMENTS)) {
                const segmentPoints = [];

                for (const k of linspace(0, layers.shape[1 - dir_i] - 1, WIREFRAME_RESOLUTION)) {
                    let x = dir_i === 0 ? i : k;
                    let y = dir_i === 0 ? k : i;
                    const z = layers.data[j + layers.shape[2] * (y + layers.shape[1] * x)];
                    segmentPoints.push(x, z, y);
                }
                allPoints.push(...segmentPoints);

                const nPoints = segmentPoints.length / 3;
                for (let l = 0; l < nPoints - 1; l++) {
                    allLines.push(pointsPerSegment);
                    allLines.push(pointOffset + l);
                    allLines.push(pointOffset + l + 1);
                }
                pointOffset += nPoints;
            }
        }

        const polyData = vtkPolyData.newInstance();
        polyData.getPoints().setData(Float32Array.from(allPoints), 3);
        polyData.getLines().setData(Uint32Array.from(allLines));

        const mapper = vtkMapper.newInstance();
        mapper.setInputData(polyData);

        const actor = vtkActor.newInstance();
        actor.setMapper(mapper);

        const actorProperty = actor.getProperty();
        actorProperty.setColor(LAYER_COLORS[j]);
        actorProperty.setOpacity(WIREFRAME_OPACITY);
        actorProperty.setLineWidth(WIREFRAME_WIDTH);
        actorProperty.setBackfaceCulling(false);
        actorProperty.setFrontfaceCulling(false);

        layerActors[j] = actor;
    }
    return layerActors;
}

async function loadModel(idx) {
    try {
        const url = MODEL_FILES[idx];
        const reader = vtkSTLReader.newInstance();
        const modelMapper = vtkMapper.newInstance();
        const model = vtkActor.newInstance();

        const normals = vtkPolyDataNormals.newInstance();
        normals.setInputConnection(reader.getOutputPort());
        modelMapper.setInputConnection(normals.getOutputPort());
        model.setMapper(modelMapper);
        modelMapper.setScalarVisibility(false);

        const response = await fetch(url);
        const arrayBuffer = await response.arrayBuffer();
        reader.parseAsArrayBuffer(arrayBuffer);

        const model_scale = 170;
        model.setScale(model_scale, model_scale, model_scale);
        if (idx !== 0) model.setPosition(55, -100, 50);
        else model.setPosition(-348, -100, 50); // Set position of pupil separately
        model.getProperty().setColor(MODEL_COLORS[idx]);
        return model;
    } catch (error) {
        console.error('Error loading STL model:', error);
    }
}

function createVectorText(text, font) {
    try {
        const textSource = vtkVectorText.newInstance({ earcut });

        const textMapper = vtkMapper.newInstance();
        const textActor = vtkActor.newInstance();

        textMapper.setInputConnection(textSource.getOutputPort());
        textActor.setMapper(textMapper);

        textSource.setFont(font);
        textSource.setText(text);

        return textActor;
    } catch (error) {
        console.error('Error loading font or setting up text:', error);
    }
}

function createColorScale(maxAttr) {
    const mapper = vtkMapper.newInstance();
    const lut = vtkColorTransferFunction.newInstance();
    lut.addRGBPoint(0.0, 0, 0, 0);
    lut.addRGBPoint(maxAttr, 1, 0, 0);

    mapper.setColorModeToMapScalars();
    mapper.setLookupTable(lut);
    mapper.setScalarRange(0.0, maxAttr);
    mapper.setScalarVisibility(true);

    const scalarBar = vtkScalarBarActor.newInstance();
    scalarBar.setAxisLabel('Attribution');
    scalarBar.setAxisTextStyle({
        fontColor: 'black',
        fontSize: 20,
        fontFamily: 'arial',
    });
    scalarBar.setScalarsToColors(lut);
    scalarBar.setTickTextStyle({
        fontColor: 'black',
        fontSize: 20,
        fontFamily: 'arial',
    });
    scalarBar.setDrawNanAnnotation(false);
    return scalarBar;
}


async function setupScene() {
    const fullScreenRenderWindow = vtkFullScreenRenderWindow.newInstance({
        background: [1, 1, 1],
    });
    fullScreenRenderWindow.addController(controlPanel);
    const renderWindow = fullScreenRenderWindow.getRenderWindow();
    const renderer = fullScreenRenderWindow.getRenderer();

    const np = new npyjs();
    const attr = await np.load('./data/attr.npy');
    const maxAttr = attr.data.reduce((a, b) => Math.max(a, b), -Infinity);
    const layers = await np.load('./data/layers.npy');

    // Render attribution 3d heatmap
    const heatmapActor = createHeatmapVolume(attr, maxAttr);
    renderer.addVolume(heatmapActor);

    // Add heatmap color scale
    const scalarBar = createColorScale(maxAttr);
    renderer.addActor2D(scalarBar);

    // Render retinal layer wireframe
    const wireframeActors = createWireframe(layers);
    for (const [i, actor] of Object.entries(wireframeActors)) {
        renderer.addActor(actor);

        const label = document.querySelector('#layerLabel' + i.toString());
        const rgbColor = LAYER_COLORS[i];
        label.style.color = `rgb(${Math.round(rgbColor[0] * 255)}, ${Math.round(rgbColor[1] * 255)}, ${Math.round(rgbColor[2] * 255)})`;

        const toggle = document.querySelector('#layerToggle' + i.toString());
        toggle.addEventListener('change', (event) => {
            const isChecked = event.target.checked;
            actor.setVisibility(isChecked);
            renderWindow.render();
        });
    }

    // Render eye model
    const eyeModels = [];
    for (let i = 0; i < MODEL_FILES.length; i++) {
        const model = await loadModel(i);
        eyeModels.push(model);
        renderer.addActor(model);
    }

    const toggle = document.querySelector('#eyeToggle');
    toggle.addEventListener('change', (event) => {
        const isChecked = event.target.checked;
        eyeModels.forEach(actor => {
            actor.setVisibility(isChecked);
        });
        renderer.resetCamera();
        renderWindow.render();
    });

    // Render vector text labels
    const font = await opentype.load(FONT_URL);
    const textLabelTemporal = createVectorText('Temporal', font);
    textLabelTemporal.setPosition(-15, 30, 75);
    textLabelTemporal.setScale(1, 1, 1);
    textLabelTemporal.setOrientation(0, -90, -270);
    textLabelTemporal.getProperty().setColor(0.0, 0.0, 1.0);
    renderer.addActor(textLabelTemporal);

    const textLabelNasal = createVectorText('Nasal', font);
    textLabelNasal.setPosition(115, 30, 65);
    textLabelNasal.setScale(1, 1, 1);
    textLabelNasal.setOrientation(0, -90, -270);
    textLabelNasal.getProperty().setColor(1.0, 0.0, 0.0);
    renderer.addActor(textLabelNasal);

    // Set the camera and render the visualization
    renderer.resetCamera();
    renderWindow.render();
}

async function main() {
    const loadingOverlay = document.querySelector('#loading-overlay');
    try {
        await setupScene();
    } catch (error) {
        console.error('Failed to load the visualisation:', error);
        loadingOverlay.innerHTML = '<p>Error creating visualisation. Please try refreshing.</p>';
    } finally {
        loadingOverlay.style.display = 'none';
    }
}

main();
