import '@kitware/vtk.js/Rendering/Profiles/Volume';
import '@kitware/vtk.js/Rendering/Profiles/Geometry';
import '@kitware/vtk.js/Rendering/Misc/RenderingAPIs';

import vtkColorTransferFunction from '@kitware/vtk.js/Rendering/Core/ColorTransferFunction';
import vtkDataArray from '@kitware/vtk.js/Common/Core/DataArray';
import vtkFullScreenRenderWindow from '@kitware/vtk.js/Rendering/Misc/FullScreenRenderWindow';
import vtkGenericRenderWindow from '@kitware/vtk.js/Rendering/Misc/GenericRenderWindow';
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
import vtkTextActor from '@kitware/vtk.js/Rendering/Core/TextActor';
import vtkTextProperty from '@kitware/vtk.js/Rendering/Core/TextProperty';
import npyjs from 'npyjs';
import Delaunator from 'delaunator';
import * as opentype from 'opentype.js';
import earcut from 'earcut';

const MESH_REDUCE = 8;
const MESH_OPACITY = 0.2;
const LINE_REDUCE = 8;
const LINE_OPACITY = 0.8;
const LINE_WIDTH = 4;

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
    1: [0, 1, 1], // cyan
    5: [0, 0, 1], // blue
    7: [1, 0.647, 0], // orange
    9: [1, 0.753, 0.796], // pink
};

const MODEL_FILES = [
    './data/Lens_Pupil.stl',
    './data/Retina_Optic_Disk.stl',
    './data/Chloroid_Cilliary_Body_Suspensory_Ligaments.stl',
    './data/Iris.stl',
];

const MODEL_COLORS = [
    [0, 0, 0], // black
    [0.88, 0.64, 0.375], // orange
    [1, 0.502, 0.482], // pink
    [0, 0, 1], // blue
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

function createWireframe(layers) {
    const lineActors = [];
    for (const dir_i of [0, 1]) { // x to y, and y to x
        for (let ir = 0; ir < layers.shape[dir_i]; ir += LINE_REDUCE) {
            const i = Math.min(Math.round(ir), layers.shape[dir_i] - 1);
            for (const j of LAYER_INDICES) { // Per segmentation boundary
                const points = [];
                for (let k = 0; k < layers.shape[1 - dir_i]; k++) {
                    let x = dir_i === 0 ? i : k;
                    let y = dir_i === 0 ? k : i;
                    const z = layers.data[j + layers.shape[2] * (y + layers.shape[1] * x)];
                    points.push(x, z, y);
                }

                const polyData = vtkPolyData.newInstance();
                polyData.getPoints().setData(Float32Array.from(points), 3);

                const nPoints = points.length / 3;
                const lines = new Uint32Array(1 + 2 * (nPoints - 1));
                lines[0] = nPoints;
                for (let l = 0; l < nPoints - 1; l++) {
                    lines[1 + 2 * l] = l;
                    lines[1 + 2 * l + 1] = l + 1;
                }

                polyData.getLines().setData(lines);

                const mapper = vtkMapper.newInstance();
                mapper.setInputData(polyData);

                const actor = vtkActor.newInstance();
                actor.setMapper(mapper);

                const actorProperty = actor.getProperty();
                actorProperty.setColor(LAYER_COLORS[j]);
                actorProperty.setOpacity(LINE_OPACITY);
                actorProperty.setLineWidth(LINE_WIDTH);
                actorProperty.setBackfaceCulling(false);
                actorProperty.setFrontfaceCulling(false);
                lineActors.push(actor);
            }
        }
    }
    return lineActors;
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

        model.setScale(250, 250, 250);
        if (idx !== 0) model.setPosition(55, -175, 50);
        else model.setPosition(-535, -175, 50); // Set position of pupil separately
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

function createLayerLegend() {
    const textActors = [];
    for (const i of LAYER_INDICES) { // Per segmentation boundary
        const textActor = vtkTextActor.newInstance();
        textActor.setInput(LAYER_NAMES[i]);

        const textProperty = textActor.getProperty();
        textProperty.setColor(LAYER_COLORS[i]);
        textProperty.setFontFamily('Arial');
        textProperty.setFontSizeScale(1.8);
        textProperty.setResolution(200);

        textActor.setDisplayPosition(10, 60 * textActors.length);
        console.log('Text color:', textActor.getProperty().getFontColor());
        console.log('Font size scale:', textActor.getProperty().getFontSizeScale());
        textActor.setInput(LAYER_NAMES[i]);
        textActors.push(textActor);
    }
    return textActors;
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


async function main() {
    // const fullScreenRenderWindow = vtkFullScreenRenderWindow.newInstance({
    //     background: [1, 1, 1],
    // });
    // const renderWindow = fullScreenRenderWindow.getRenderWindow();
    // const renderer = fullScreenRenderWindow.getRenderer();

    const genericRenderWindow = vtkGenericRenderWindow.newInstance({
        background: [1, 1, 1],
    });
    genericRenderWindow.setContainer(document.getElementById('vtk-container'));
    genericRenderWindow.resize();
    const renderer = genericRenderWindow.getRenderer();
    const renderWindow = genericRenderWindow.getRenderWindow();

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
    wireframeActors.forEach(actor => { renderer.addActor(actor); });

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
    textLabelTemporal.setPosition(-5, 30, 35);
    textLabelTemporal.setScale(1, 1, 1);
    textLabelTemporal.setOrientation(0, 90, 270);
    textLabelTemporal.getProperty().setColor(0.0, 0.0, 1.0);
    renderer.addActor(textLabelTemporal);

    const textLabelNasal = createVectorText('Nasal', font);
    textLabelNasal.setPosition(125, 30, 42);
    textLabelNasal.setScale(1, 1, 1);
    textLabelNasal.setOrientation(0, 90, 270);
    textLabelNasal.getProperty().setColor(1.0, 0.0, 0.0);
    renderer.addActor(textLabelNasal);

    // Create layer legend
    // const legendTextActors = createLayerLegend();
    // legendTextActors.forEach(actor => { renderer.addActor(actor); });

    // Set the camera and render the visualization
    renderer.resetCamera();
    renderWindow.render();
}

main();
