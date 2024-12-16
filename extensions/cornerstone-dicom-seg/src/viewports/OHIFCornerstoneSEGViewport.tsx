import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LoadingIndicatorTotalPercent, useViewportGrid, ViewportActionArrows } from '@ohif/ui';
import createSEGToolGroupAndAddTools from '../utils/initSEGToolGroup';
import promptHydrateSEG from '../utils/promptHydrateSEG';
import _getStatusComponent from './_getStatusComponent';
import { usePositionPresentationStore } from '@ohif/extension-cornerstone';
import { SegmentationRepresentations } from '@cornerstonejs/tools/enums';

const SEG_TOOLGROUP_BASE_NAME = 'SEGToolGroup';

function OHIFCornerstoneSEGViewport(props: withAppTypes) {
  const {
    children,
    displaySets,
    viewportOptions,
    servicesManager,
    extensionManager,
    commandsManager,
  } = props;

  const { t } = useTranslation('SEGViewport');
  const viewportId = viewportOptions.viewportId;

  const {
    displaySetService,
    toolGroupService,
    segmentationService,
    customizationService,
    viewportActionCornersService,
  } = servicesManager.services;

  const toolGroupId = `${SEG_TOOLGROUP_BASE_NAME}-${viewportId}`;

  // SEG viewport will always have a single display set
  if (displaySets.length > 1) {
    throw new Error('SEG viewport should only have a single display set');
  }

  const segDisplaySet = displaySets[0];
  const [viewportGrid, viewportGridService] = useViewportGrid();

  // States
  const [selectedSegment, setSelectedSegment] = useState(1);
  const { setPositionPresentation } = usePositionPresentationStore();

  // Hydration means that the SEG is opened and segments are loaded into the
  // segmentation panel, and SEG is also rendered on any viewport that is in the
  // same frameOfReferenceUID as the referencedSeriesUID of the SEG. However,
  // loading basically means SEG loading over network and bit unpacking of the
  // SEG data.
  const [isHydrated, setIsHydrated] = useState(segDisplaySet.isHydrated);
  const [segIsLoading, setSegIsLoading] = useState(!segDisplaySet.isLoaded);
  const [element, setElement] = useState(null);
  const [processingProgress, setProcessingProgress] = useState({
    percentComplete: null,
    totalSegments: null,
  });

  // refs
  const referencedDisplaySetRef = useRef(null);

  const { viewports, activeViewportId } = viewportGrid;

  const referencedDisplaySetInstanceUID = segDisplaySet.referencedDisplaySetInstanceUID;
  const referencedDisplaySet = displaySetService.getDisplaySetByUID(
    referencedDisplaySetInstanceUID
  );

  const referencedDisplaySetMetadata = _getReferencedDisplaySetMetadata(
    referencedDisplaySet,
    segDisplaySet
  );

  referencedDisplaySetRef.current = {
    displaySet: referencedDisplaySet,
    metadata: referencedDisplaySetMetadata,
  };
  /**
   * OnElementEnabled callback which is called after the cornerstoneExtension
   * has enabled the element. Note: we delegate all the image rendering to
   * cornerstoneExtension, so we don't need to do anything here regarding
   * the image rendering, element enabling etc.
   */
  const onElementEnabled = evt => {
    setElement(evt.detail.element);
  };

  const onElementDisabled = () => {
    setElement(null);
  };

  const storePresentationState = useCallback(() => {
    viewportGrid?.viewports.forEach(({ viewportId }) => {
      commandsManager.runCommand('storePresentation', {
        viewportId,
      });
    });
  }, [viewportGrid]);

  const getCornerstoneViewport = useCallback(() => {
    const { component: Component } = extensionManager.getModuleEntry(
      '@ohif/extension-cornerstone.viewportModule.cornerstone'
    );

    // Todo: jump to the center of the first segment
    return (
      <Component
        {...props}
        displaySets={[segDisplaySet]}
        viewportOptions={{
          viewportType: viewportOptions.viewportType,
          toolGroupId: toolGroupId,
          orientation: viewportOptions.orientation,
          viewportId: viewportOptions.viewportId,
          presentationIds: viewportOptions.presentationIds,
        }}
        onElementEnabled={evt => {
          props.onElementEnabled?.(evt);
          onElementEnabled(evt);
        }}
        onElementDisabled={onElementDisabled}
      ></Component>
    );
  }, [viewportId, segDisplaySet, toolGroupId]);

  const onSegmentChange = useCallback(
    direction => {
      const segmentationId = segDisplaySet.displaySetInstanceUID;
      const segmentation = segmentationService.getSegmentation(segmentationId);

      const { segments } = segmentation;

      const numberOfSegments = Object.keys(segments).length;

      let newSelectedSegmentIndex = selectedSegment + direction;

      // Segment 0 is always background

      if (newSelectedSegmentIndex > numberOfSegments - 1) {
        newSelectedSegmentIndex = 1;
      } else if (newSelectedSegmentIndex === 0) {
        newSelectedSegmentIndex = numberOfSegments - 1;
      }

      segmentationService.jumpToSegmentCenter(segmentationId, newSelectedSegmentIndex, viewportId);
      setSelectedSegment(newSelectedSegmentIndex);
    },
    [selectedSegment]
  );

  const hydrateSEG = useCallback(() => {
    // update the previously stored segmentationPresentation with the new viewportId
    // presentation so that when we put the referencedDisplaySet back in the viewport
    // it will have the correct segmentation representation hydrated
    commandsManager.runCommand('updateStoredSegmentationPresentation', {
      displaySet: segDisplaySet,
      type: SegmentationRepresentations.Labelmap,
    });

    // update the previously stored positionPresentation with the new viewportId
    // presentation so that when we put the referencedDisplaySet back in the viewport
    // it will be in the correct position zoom and pan
    commandsManager.runCommand('updateStoredPositionPresentation', {
      viewportId,
      displaySetInstanceUID: referencedDisplaySet.displaySetInstanceUID,
    });

    viewportGridService.setDisplaySetsForViewport({
      viewportId,
      displaySetInstanceUIDs: [referencedDisplaySet.displaySetInstanceUID],
    });
  }, [commandsManager, viewportId, referencedDisplaySet, segDisplaySet]);

  useEffect(() => {
    if (segIsLoading) {
      return;
    }

    promptHydrateSEG({
      servicesManager,
      viewportId,
      segDisplaySet,
      preHydrateCallbacks: [storePresentationState],
      hydrateCallback: hydrateSEG,
    }).then(isHydrated => {
      if (isHydrated) {
        setIsHydrated(true);
      }
    });
  }, [servicesManager, viewportId, segDisplaySet, segIsLoading, hydrateSEG]);

  useEffect(() => {
    // on new seg display set, remove all segmentations from all viewports
    segmentationService.clearSegmentationRepresentations(viewportId);

    const { unsubscribe } = segmentationService.subscribe(
      segmentationService.EVENTS.SEGMENTATION_LOADING_COMPLETE,
      evt => {
        if (evt.segDisplaySet.displaySetInstanceUID === segDisplaySet.displaySetInstanceUID) {
          setSegIsLoading(false);
        }

        if (segDisplaySet?.firstNonZeroVoxelImageId && viewportOptions?.presentationIds) {
          const { firstNonZeroVoxelImageId } = segDisplaySet;
          const { presentationIds } = viewportOptions;

          setPositionPresentation(presentationIds.positionPresentationId, {
            viewReference: {
              referencedImageId: firstNonZeroVoxelImageId,
            },
          });
        }
      }
    );

    return () => {
      unsubscribe();
    };
  }, [segDisplaySet]);

  useEffect(() => {
    const { unsubscribe } = segmentationService.subscribe(
      segmentationService.EVENTS.SEGMENT_LOADING_COMPLETE,
      ({ percentComplete, numSegments }) => {
        setProcessingProgress({
          percentComplete,
          totalSegments: numSegments,
        });
      }
    );

    return () => {
      unsubscribe();
    };
  }, [segDisplaySet]);

  /**
   Cleanup the SEG viewport when the viewport is destroyed
   */
  useEffect(() => {
    const onDisplaySetsRemovedSubscription = displaySetService.subscribe(
      displaySetService.EVENTS.DISPLAY_SETS_REMOVED,
      ({ displaySetInstanceUIDs }) => {
        const activeViewport = viewports.get(activeViewportId);
        if (displaySetInstanceUIDs.includes(activeViewport.displaySetInstanceUID)) {
          viewportGridService.setDisplaySetsForViewport({
            viewportId: activeViewportId,
            displaySetInstanceUIDs: [],
          });
        }
      }
    );

    return () => {
      onDisplaySetsRemovedSubscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    let toolGroup = toolGroupService.getToolGroup(toolGroupId);

    if (toolGroup) {
      return;
    }

    // keep the already stored segmentationPresentation for this viewport in memory
    // so that we can restore it after hydrating the SEG
    commandsManager.runCommand('updateStoredSegmentationPresentation', {
      displaySet: segDisplaySet,
      type: SegmentationRepresentations.Labelmap,
    });

    // always start fresh for this viewport since it is special type of viewport
    // that should only show one segmentation at a time.
    segmentationService.clearSegmentationRepresentations(viewportId);

    // This creates a custom tool group which has the lifetime of this view
    // only, and does NOT interfere with currently displayed segmentations.
    toolGroup = createSEGToolGroupAndAddTools(toolGroupService, customizationService, toolGroupId);

    return () => {
      // remove the segmentation representations if seg displayset changed
      // e.g., another seg displayset is dragged into the viewport
      segmentationService.clearSegmentationRepresentations(viewportId);

      // Only destroy the viewport specific implementation
      toolGroupService.destroyToolGroup(toolGroupId);
    };
  }, []);

  const onStatusClick = useCallback(async () => {
    // Before hydrating a SEG and make it added to all viewports in the grid
    // that share the same frameOfReferenceUID, we need to store the viewport grid
    // presentation state, so that we can restore it after hydrating the SEG. This is
    // required if the user has changed the viewport (other viewport than SEG viewport)
    // presentation state (w/l and invert) and then opens the SEG. If we don't store
    // the presentation state, the viewport will be reset to the default presentation
    storePresentationState();
    hydrateSEG();
  }, [storePresentationState, hydrateSEG]);

  useEffect(() => {
    viewportActionCornersService.addComponents([
      {
        viewportId,
        id: 'viewportStatusComponent',
        component: _getStatusComponent({
          isHydrated,
          onStatusClick,
        }),
        indexPriority: -100,
        location: viewportActionCornersService.LOCATIONS.topLeft,
      },
      {
        viewportId,
        id: 'viewportActionArrowsComponent',
        component: (
          <ViewportActionArrows
            key="actionArrows"
            onArrowsClick={onSegmentChange}
            className={
              viewportId === activeViewportId ? 'visible' : 'invisible group-hover/pane:visible'
            }
          ></ViewportActionArrows>
        ),
        indexPriority: 0,
        location: viewportActionCornersService.LOCATIONS.topRight,
      },
    ]);
  }, [
    activeViewportId,
    isHydrated,
    onSegmentChange,
    onStatusClick,
    viewportActionCornersService,
    viewportId,
  ]);

  // ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
  let childrenWithProps = null;

  if (
    !referencedDisplaySetRef.current ||
    referencedDisplaySet.displaySetInstanceUID !==
      referencedDisplaySetRef.current.displaySet.displaySetInstanceUID
  ) {
    return null;
  }

  if (children && children.length) {
    childrenWithProps = children.map((child, index) => {
      return (
        child &&
        React.cloneElement(child, {
          viewportId,
          key: index,
        })
      );
    });
  }

  return (
    <>
      <div className="relative flex h-full w-full flex-row overflow-hidden">
        {segIsLoading && (
          <LoadingIndicatorTotalPercent
            className="h-full w-full"
            totalNumbers={processingProgress.totalSegments}
            percentComplete={processingProgress.percentComplete}
            loadingText="Loading SEG..."
          />
        )}
        {getCornerstoneViewport()}
        {childrenWithProps}
      </div>
    </>
  );
}

function _getReferencedDisplaySetMetadata(referencedDisplaySet, segDisplaySet) {
  const { SharedFunctionalGroupsSequence } = segDisplaySet.instance;

  const SharedFunctionalGroup = Array.isArray(SharedFunctionalGroupsSequence)
    ? SharedFunctionalGroupsSequence[0]
    : SharedFunctionalGroupsSequence;

  const { PixelMeasuresSequence } = SharedFunctionalGroup;

  const PixelMeasures = Array.isArray(PixelMeasuresSequence)
    ? PixelMeasuresSequence[0]
    : PixelMeasuresSequence;

  const { SpacingBetweenSlices, SliceThickness } = PixelMeasures;

  const image0 = referencedDisplaySet.images[0];
  const referencedDisplaySetMetadata = {
    PatientID: image0.PatientID,
    PatientName: image0.PatientName,
    PatientSex: image0.PatientSex,
    PatientAge: image0.PatientAge,
    SliceThickness: image0.SliceThickness || SliceThickness,
    StudyDate: image0.StudyDate,
    SeriesDescription: image0.SeriesDescription,
    SeriesInstanceUID: image0.SeriesInstanceUID,
    SeriesNumber: image0.SeriesNumber,
    ManufacturerModelName: image0.ManufacturerModelName,
    SpacingBetweenSlices: image0.SpacingBetweenSlices || SpacingBetweenSlices,
  };

  return referencedDisplaySetMetadata;
}

export default OHIFCornerstoneSEGViewport;
