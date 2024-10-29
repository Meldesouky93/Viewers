import React from 'react';
import * as cornerstone from '@cornerstonejs/core';
import * as cornerstoneTools from '@cornerstonejs/tools';
import {
  Enums as cs3DEnums,
  imageLoadPoolManager,
  imageRetrievalPoolManager,
} from '@cornerstonejs/core';
import { Enums as cs3DToolsEnums } from '@cornerstonejs/tools';
import { Types } from '@ohif/core';
import Enums from './enums';

import init from './init';
import getCustomizationModule from './getCustomizationModule';
import getCommandsModule from './commandsModule';
import getHangingProtocolModule from './getHangingProtocolModule';
import getToolbarModule from './getToolbarModule';
import ToolGroupService from './services/ToolGroupService';
import SyncGroupService from './services/SyncGroupService';
import SegmentationService from './services/SegmentationService';
import CornerstoneCacheService from './services/CornerstoneCacheService';
import CornerstoneViewportService from './services/ViewportService/CornerstoneViewportService';
import ColorbarService from './services/ColorbarService';
import * as CornerstoneExtensionTypes from './types';

import { toolNames } from './initCornerstoneTools';
import { getEnabledElement, reset as enabledElementReset, setEnabledElement } from './state';
import dicomLoaderService from './utils/dicomLoaderService';
import getActiveViewportEnabledElement from './utils/getActiveViewportEnabledElement';

import { id } from './id';
import { measurementMappingUtils } from './utils/measurementServiceMappings';
import type { PublicViewportOptions } from './services/ViewportService/Viewport';
import ImageOverlayViewerTool from './tools/ImageOverlayViewerTool';
import ViewportActionCornersService from './services/ViewportActionCornersService/ViewportActionCornersService';
import { ViewportActionCornersProvider } from './contextProviders/ViewportActionCornersProvider';
import getSOPInstanceAttributes from './utils/measurementServiceMappings/utils/getSOPInstanceAttributes';
import { findNearbyToolData } from './utils/findNearbyToolData';
import { createFrameViewSynchronizer } from './synchronizers/frameViewSynchronizer';
import { getSopClassHandlerModule } from './getSopClassHandlerModule';
import { getDynamicVolumeInfo } from '@cornerstonejs/core/utilities';
import {
  useLutPresentationStore,
  usePositionPresentationStore,
  useSegmentationPresentationStore,
  useSynchronizersStore,
} from './stores';
import { useToggleOneUpViewportGridStore } from '../../default/src/stores/useToggleOneUpViewportGridStore';
import { useActiveViewportSegmentationRepresentations } from './hooks/useActiveViewportSegmentationRepresentations';
import { useMeasurements } from './hooks/useMeasurements';
import getPanelModule from './getPanelModule';
import PanelSegmentation from './panels/PanelSegmentation';
import PanelMeasurement from './panels/PanelMeasurement';
import DicomUpload from './components/DicomUpload/DicomUpload';

const { imageRetrieveMetadataProvider } = cornerstone.utilities;

const Component = React.lazy(() => {
  return import(/* webpackPrefetch: true */ './Viewport/OHIFCornerstoneViewport');
});

const OHIFCornerstoneViewport = props => {
  return (
    <React.Suspense fallback={<div>Loading...</div>}>
      <Component {...props} />
    </React.Suspense>
  );
};

const stackRetrieveOptions = {
  retrieveOptions: {
    single: {
      streaming: true,
      decodeLevel: 1,
    },
  },
};

/**
 *
 */
const cornerstoneExtension: Types.Extensions.Extension = {
  /**
   * Only required property. Should be a unique value across all extensions.
   */
  id,

  onModeEnter: ({ servicesManager }: withAppTypes): void => {
    const { cornerstoneViewportService, toolbarService, segmentationService } =
      servicesManager.services;
    toolbarService.registerEventForToolbarUpdate(cornerstoneViewportService, [
      cornerstoneViewportService.EVENTS.VIEWPORT_DATA_CHANGED,
    ]);

    toolbarService.registerEventForToolbarUpdate(segmentationService, [
      segmentationService.EVENTS.SEGMENTATION_REMOVED,
      segmentationService.EVENTS.SEGMENTATION_MODIFIED,
    ]);

    toolbarService.registerEventForToolbarUpdate(cornerstone.eventTarget, [
      cornerstoneTools.Enums.Events.TOOL_ACTIVATED,
    ]);

    // Configure the interleaved/HTJ2K loader
    imageRetrieveMetadataProvider.clear();
    // The default volume interleaved options are to interleave the
    // image retrieve, but don't perform progressive loading per image
    // This interleaves images and replicates them for low-resolution depth volume
    // reconstruction, which progressively improves
    imageRetrieveMetadataProvider.add(
      'volume',
      cornerstone.ProgressiveRetrieveImages.interleavedRetrieveStages
    );
    // The default stack loading option is to progressive load HTJ2K images
    // There are other possible options, but these need more thought about
    // how to define them.
    imageRetrieveMetadataProvider.add('stack', stackRetrieveOptions);
  },
  getPanelModule,
  onModeExit: ({ servicesManager }: withAppTypes): void => {
    const { cineService, segmentationService } = servicesManager.services;
    // Empty out the image load and retrieval pools to prevent memory leaks
    // on the mode exits
    Object.values(cs3DEnums.RequestType).forEach(type => {
      imageLoadPoolManager.clearRequestStack(type);
      imageRetrievalPoolManager.clearRequestStack(type);
    });

    cineService.setIsCineEnabled(false);

    enabledElementReset();

    useLutPresentationStore.getState().clearLutPresentationStore();
    usePositionPresentationStore.getState().clearPositionPresentationStore();
    useSynchronizersStore.getState().clearSynchronizersStore();
    useToggleOneUpViewportGridStore.getState().clearToggleOneUpViewportGridStore();
    useSegmentationPresentationStore.getState().clearSegmentationPresentationStore();
    segmentationService.removeAllSegmentations();
  },

  /**
   * Register the Cornerstone 3D services and set them up for use.
   *
   * @param configuration.csToolsConfig - Passed directly to `initCornerstoneTools`
   */
  preRegistration: function (props: Types.Extensions.ExtensionParams): Promise<void> {
    const { servicesManager, serviceProvidersManager } = props;
    servicesManager.registerService(CornerstoneViewportService.REGISTRATION);
    servicesManager.registerService(ToolGroupService.REGISTRATION);
    servicesManager.registerService(SyncGroupService.REGISTRATION);
    servicesManager.registerService(SegmentationService.REGISTRATION);
    servicesManager.registerService(CornerstoneCacheService.REGISTRATION);
    servicesManager.registerService(ViewportActionCornersService.REGISTRATION);
    servicesManager.registerService(ColorbarService.REGISTRATION);

    serviceProvidersManager.registerProvider(
      ViewportActionCornersService.REGISTRATION.name,
      ViewportActionCornersProvider
    );

    const { syncGroupService } = servicesManager.services;
    syncGroupService.registerCustomSynchronizer('frameview', createFrameViewSynchronizer);
    servicesManager.services.customizationService.setGlobalCustomization('dicomUploadComponent', {
      component: props => <DicomUpload {...props} />,
    });
    return init.call(this, props);
  },
  getToolbarModule,
  getHangingProtocolModule,
  getViewportModule({ servicesManager, commandsManager }) {
    const ExtendedOHIFCornerstoneViewport = props => {
      // const onNewImageHandler = jumpData => {
      //   commandsManager.runCommand('jumpToImage', jumpData);
      // };
      const { toolbarService } = servicesManager.services;

      return (
        <OHIFCornerstoneViewport
          {...props}
          toolbarService={toolbarService}
          servicesManager={servicesManager}
          commandsManager={commandsManager}
        />
      );
    };

    return [
      {
        name: 'cornerstone',
        component: ExtendedOHIFCornerstoneViewport,
      },
    ];
  },
  getCommandsModule,
  getCustomizationModule,
  getUtilityModule({ servicesManager }) {
    return [
      {
        name: 'common',
        exports: {
          getCornerstoneLibraries: () => {
            return { cornerstone, cornerstoneTools };
          },
          getEnabledElement,
          dicomLoaderService,
        },
      },
      {
        name: 'core',
        exports: {
          Enums: cs3DEnums,
        },
      },
      {
        name: 'tools',
        exports: {
          toolNames,
          Enums: cs3DToolsEnums,
        },
      },
      {
        name: 'volumeLoader',
        exports: {
          getDynamicVolumeInfo,
        },
      },
    ];
  },
  getSopClassHandlerModule,
};

export type { PublicViewportOptions };
export {
  measurementMappingUtils,
  CornerstoneExtensionTypes as Types,
  toolNames,
  getActiveViewportEnabledElement,
  setEnabledElement,
  findNearbyToolData,
  getEnabledElement,
  ImageOverlayViewerTool,
  getSOPInstanceAttributes,
  dicomLoaderService,
  // Export all stores
  useLutPresentationStore,
  usePositionPresentationStore,
  useSegmentationPresentationStore,
  useSynchronizersStore,
  Enums,
  useMeasurements,
  useActiveViewportSegmentationRepresentations,
  PanelSegmentation,
  PanelMeasurement,
  DicomUpload,
};
export default cornerstoneExtension;
