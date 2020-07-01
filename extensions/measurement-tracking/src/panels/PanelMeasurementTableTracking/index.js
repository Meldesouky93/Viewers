import React, { useEffect, useState } from 'react';
import { StudySummary, MeasurementTable, Dialog, Input, useViewportGrid } from '@ohif/ui';
import { DicomMetadataStore, DICOMSR } from '@ohif/core';
import { useDebounce } from '@hooks';
import ActionButtons from './ActionButtons';
import cornerstone from 'cornerstone-core';
import { useTrackedMeasurements } from '../../getContextModule';

const DISPLAY_STUDY_SUMMARY_INITIAL_VALUE = {
  key: undefined, //
  date: undefined, // '07-Sep-2010',
  modality: undefined, // 'CT',
  description: undefined, // 'CHEST/ABD/PELVIS W CONTRAST',
};

function PanelMeasurementTableTracking({ servicesManager, extensionManager }) {
  const [viewportGrid, viewportGridService] = useViewportGrid();
  const [measurementChangeTimestamp, setMeasurementsUpdated] = useState(
    Date.now().toString()
  );
  const debouncedMeasurementChangeTimestamp = useDebounce(
    measurementChangeTimestamp,
    200
  );
  const { MeasurementService, UINotificationService, UIDialogService, DisplaySetService } = servicesManager.services;
  const [trackedMeasurements, sendTrackedMeasurementsEvent] = useTrackedMeasurements();
  const { trackedStudy, trackedSeries } = trackedMeasurements.context;
  const [displayStudySummary, setDisplayStudySummary] = useState(
    DISPLAY_STUDY_SUMMARY_INITIAL_VALUE
  );
  const [displayMeasurements, setDisplayMeasurements] = useState([]);
  const [measurements, setMeasurements] = useState([]);

  // Initial?
  useEffect(() => {
    const measurements = MeasurementService.getMeasurements();
    const filteredMeasurements = measurements.filter(
      m =>
        trackedStudy === m.referenceStudyUID &&
        trackedSeries.includes(m.referenceSeriesUID)
    );
    const mappedMeasurements = filteredMeasurements.map((m, index) =>
      _mapMeasurementToDisplay(m, index, MeasurementService.VALUE_TYPES)
    );
    setDisplayMeasurements(mappedMeasurements);
    setMeasurements(filteredMeasurements);
    // eslint-ignore-next-line
  }, [
    MeasurementService,
    trackedStudy,
    trackedSeries,
    debouncedMeasurementChangeTimestamp,
  ]);

  // ~~ DisplayStudySummary
  useEffect(() => {
    if (trackedMeasurements.matches('tracking')) {
      const StudyInstanceUID = trackedStudy;
      const studyMeta = DicomMetadataStore.getStudy(StudyInstanceUID);
      const instanceMeta = studyMeta.series[0].instances[0];
      const { Modality, StudyDate, StudyDescription } = instanceMeta;

      if (displayStudySummary.key !== StudyInstanceUID) {
        setDisplayStudySummary({
          key: StudyInstanceUID,
          date: StudyDate, // TODO: Format: '07-Sep-2010'
          modality: Modality,
          description: StudyDescription,
        });
      }
    } else if (trackedStudy === '' || trackedStudy === undefined) {
      setDisplayStudySummary(DISPLAY_STUDY_SUMMARY_INITIAL_VALUE);
    }
  }, [displayStudySummary.key, trackedMeasurements, trackedStudy]);

  // TODO: Better way to consolidated, debounce, check on change?
  // Are we exposing the right API for measurementService?
  // This watches for ALL MeasurementService changes. It updates a timestamp,
  // which is debounced. After a brief period of inactivity, this triggers
  // a re-render where we grab up-to-date measurements.
  useEffect(() => {
    const added = MeasurementService.EVENTS.MEASUREMENT_ADDED;
    const updated = MeasurementService.EVENTS.MEASUREMENT_UPDATED;
    const removed = MeasurementService.EVENTS.MEASUREMENT_REMOVED;
    const subscriptions = [];

    [added, updated, removed].forEach(evt => {
      subscriptions.push(
        MeasurementService.subscribe(evt, () => {
          setMeasurementsUpdated(Date.now().toString());
        }).unsubscribe
      );
    });

    return () => {
      subscriptions.forEach(unsub => {
        unsub();
      });
    };
  }, [MeasurementService, sendTrackedMeasurementsEvent]);

  const exportReport = () => {
    const measurements = MeasurementService.getMeasurements();
    const trackedMeasurements = measurements.filter(
      m =>
        trackedStudy === m.referenceStudyUID &&
        trackedSeries.includes(m.referenceSeriesUID)
    );

    // TODO -> local download.
    DICOMSR.downloadReport(trackedMeasurements, dataSource);
  };

  const createReport = async () => {
    const loadingDialogId = UIDialogService.create({
      showOverlay: true,
      isDraggable: false,
      centralize: true,
      // TODO: Create a loading indicator component + zeplin design?
      content: () => <div className="text-primary-active">Loading...</div>
    });

    try {
      const measurements = MeasurementService.getMeasurements();
      const trackedMeasurements = measurements.filter(
        m =>
          trackedStudy === m.referenceStudyUID &&
          trackedSeries.includes(m.referenceSeriesUID)
      );

      const dataSources = extensionManager.getDataSources();
      // TODO -> Eventually deal with multiple dataSources.
      // Would need some way of saying which one is the "push" dataSource
      const dataSource = dataSources[0];

      const naturalizedReport = await DICOMSR.storeMeasurements(trackedMeasurements, dataSource);

      DisplaySetService.makeDisplaySets([naturalizedReport], { madeInClient: true });
      UINotificationService.show({
        title: 'STOW SR',
        message: 'Measurements saved successfully',
        type: 'success'
      });
    } catch (error) {
      UINotificationService.show({
        title: 'STOW SR',
        message: error.message || 'Failed to store measurements',
        type: 'error',
      });
    } finally {
      UIDialogService.dismiss({ id: loadingDialogId });
    }
  };

  const jumpToImage = id => {
    onMeasurementItemClickHandler(id);

    const measurement = measurements.find(m => m.id === id);
    const { referenceSeriesUID, SOPInstanceUID } = measurement;

    const displaySets = DisplaySetService.getDisplaySetsForSeries(referenceSeriesUID);

    const displaySet = displaySets.find(ds => {
      return ds.images && ds.images.some(i => i.SOPInstanceUID === SOPInstanceUID)
    });

    const frameIndex = displaySet.images.map(i => i.SOPInstanceUID).indexOf(SOPInstanceUID);

    viewportGridService.setDisplaysetForViewport({
      viewportIndex: viewportGrid.activeViewportIndex,
      displaySetInstanceUID: displaySet.displaySetInstanceUID,
      frameIndex
    });
  };

  const onMeasurementItemEditHandler = (id) => {
    const measurement = measurements.find(m => m.id === id);

    const dialogId = UIDialogService.create({
      centralize: true,
      isDraggable: false,
      useLastPosition: false,
      showOverlay: true,
      content: Dialog,
      contentProps: {
        title: 'Edit',
        noCloseButton: true,
        value: { label: measurement.label || '' },
        body: ({ value, setValue }) => {
          const onChangeHandler = () => setValue(value => ({
            ...value, label: event.target.value
          }));
          return (
            <div className="p-4 bg-primary-dark">
              <Input
                className="border-primary-main mt-2 bg-black"
                type="text"
                containerClassName="mr-2"
                value={value.label}
                onChange={onChangeHandler}
              />
            </div>
          );
        },
        actions: [
          { id: 'edit', text: 'Edit', type: 'primary' },
          { id: 'cancel', text: 'Cancel', type: 'secondary' }
        ],
        onSubmit: ({ action, value }) => {
          switch (action.id) {
            case 'edit': {
              MeasurementService.update(id, {
                ...measurement,
                ...value
              });
              UINotificationService.show({
                title: 'Measurements',
                message: 'Label updated successfully',
                type: 'success'
              });
            }
          }
          UIDialogService.dismiss({ id: dialogId });
        },
      }
    });
  };

  const onMeasurementItemClickHandler = (id) => {
    const measurements = [...displayMeasurements];
    const measurement = measurements.find(m => m.id === id);
    measurements.forEach(m => m.isActive = m.id !== id ? false : true);
    measurement.isActive = true;
    setDisplayMeasurements(measurements);
  };

  return (
    <>
      <div className="overflow-x-hidden overflow-y-auto invisible-scrollbar">
        {displayStudySummary.key && (
          <StudySummary
            date={displayStudySummary.date}
            modality={displayStudySummary.modality}
            description={displayStudySummary.description}
          />
        )}
        <MeasurementTable
          title="Measurements"
          amount={displayMeasurements.length}
          data={displayMeasurements}
          onClick={jumpToImage}
          onEdit={onMeasurementItemEditHandler}
        />
      </div>
      <div className="flex justify-center p-4">
        <ActionButtons
          onExportClick={exportReport}
          onCreateReportClick={createReport}
        />
      </div>
    </>
  );
}

PanelMeasurementTableTracking.propTypes = {};

// TODO: This could be a MeasurementService mapper
function _mapMeasurementToDisplay(measurement, index, types) {
  const {
    id,
    label,
    description,
    // Reference IDs
    referenceStudyUID,
    referenceSeriesUID,
    SOPInstanceUID,
  } = measurement;
  const instance = DicomMetadataStore.getInstance(
    referenceStudyUID,
    referenceSeriesUID,
    SOPInstanceUID
  );
  const { PixelSpacing, SeriesNumber, InstanceNumber } = instance;

  return {
    id: measurement.id,
    label: measurement.label || '(empty)',
    displayText:
      _getDisplayText(
        measurement,
        PixelSpacing,
        SeriesNumber,
        InstanceNumber,
        types
      ) || [],
    // TODO: handle one layer down
    isActive: false, // activeMeasurementItem === i + 1,
  };
}

/**
 *
 * @param {*} points
 * @param {*} pixelSpacing
 */
function _getDisplayText(
  measurement,
  pixelSpacing,
  seriesNumber,
  instanceNumber,
  types
) {
  // TODO: determination of shape influences text
  // Length:  'xx.x unit (S:x, I:x)'
  // Rectangle: 'xx.x x xx.x unit (S:x, I:x)',
  // Ellipse?
  // Bidirectional?
  // Freehand?

  const { type, points } = measurement;

  const hasPixelSpacing =
    pixelSpacing !== undefined &&
    Array.isArray(pixelSpacing) &&
    pixelSpacing.length === 2;
  const [rowPixelSpacing, colPixelSpacing] = hasPixelSpacing
    ? pixelSpacing
    : [1, 1];
  const unit = hasPixelSpacing ? 'mm' : 'px';

  switch (type) {
    case types.POLYLINE:
      const { length } = measurement;

      const roundedLength = _round(length, 1);

      return [
        `${roundedLength} ${unit} (S:${seriesNumber}, I:${instanceNumber})`,
      ];

    case types.BIDIRECTIONAL:
      const { shortestDiameter, longestDiameter } = measurement;

      const roundedShortestDiameter = _round(shortestDiameter, 1);
      const roundedLongestDiameter = _round(longestDiameter, 1);

      return [
        `l: ${roundedLongestDiameter} ${unit} (S:${seriesNumber}, I:${instanceNumber})`,
        `s: ${roundedShortestDiameter} ${unit}`,
      ];
    case types.ELLIPSE:
      const { area } = measurement;

      const roundedArea = _round(area, 1);
      return [
        `${roundedArea} ${unit}2 (S:${seriesNumber}, I:${instanceNumber})`,
      ];
    case types.POINT:
      const { text } = measurement;
      return [`${text} (S:${seriesNumber}, I:${instanceNumber})`];
  }
}

function _round(value, decimals) {
  return Number(Math.round(value + 'e' + decimals) + 'e-' + decimals);
}

export default PanelMeasurementTableTracking;
