import React, { PureComponent } from 'react';
import PropTypes from 'prop-types';
import WhiteboardOverlayContainer from '/imports/ui/components/whiteboard/whiteboard-overlay/container';
import WhiteboardToolbarContainer from '/imports/ui/components/whiteboard/whiteboard-toolbar/container';
import { HUNDRED_PERCENT, MAX_PERCENT } from '/imports/utils/slideCalcUtils';
import { defineMessages, injectIntl, intlShape } from 'react-intl';
import { toast } from 'react-toastify';
import PresentationToolbarContainer from './presentation-toolbar/container';
import CursorWrapperContainer from './cursor/cursor-wrapper-container/container';
import AnnotationGroupContainer from '../whiteboard/annotation-group/container';
import PresentationOverlayContainer from './presentation-overlay/container';
import Slide from './slide/component';
import { styles } from './styles.scss';
import MediaService, { shouldEnableSwapLayout } from '../media/service';
import PresentationCloseButton from './presentation-close-button/component';
import DownloadPresentationButton from './download-presentation-button/component';
import FullscreenService from '../fullscreen-button/service';
import FullscreenButtonContainer from '../fullscreen-button/container';
import { withDraggableConsumer } from '../media/webcam-draggable-overlay/context';
import Icon from '/imports/ui/components/icon/component';

const intlMessages = defineMessages({
  presentationLabel: {
    id: 'app.presentationUploder.title',
    description: 'presentation area element label',
  },
  changeNotification: {
    id: 'app.presentation.notificationLabel',
    description: 'label displayed in toast when presentation switches',
  },
});

const ALLOW_FULLSCREEN = Meteor.settings.public.app.allowFullscreen;

class PresentationArea extends PureComponent {
  constructor() {
    super();

    this.state = {
      presentationAreaWidth: 0,
      presentationAreaHeight: 0,
      showSlide: false,
      zoom: 100,
      fitToWidth: false,
      isFullscreen: false,
    };

    this.currentPresentationToastId = null;

    this.getSvgRef = this.getSvgRef.bind(this);
    this.setFitToWidth = this.setFitToWidth.bind(this);
    this.zoomChanger = this.zoomChanger.bind(this);
    this.updateLocalPosition = this.updateLocalPosition.bind(this);
    this.panAndZoomChanger = this.panAndZoomChanger.bind(this);
    this.fitToWidthHandler = this.fitToWidthHandler.bind(this);
    this.onFullscreenChange = this.onFullscreenChange.bind(this);
    this.onResize = () => setTimeout(this.handleResize.bind(this), 0);
    this.renderCurrentPresentationToast = this.renderCurrentPresentationToast.bind(this);
  }

  static getDerivedStateFromProps(props, state) {
    const { prevProps } = state;
    const stateChange = { prevProps: props };

    if (props.userIsPresenter
      && (!prevProps || !prevProps.userIsPresenter)
      && props.currentSlide
      && props.slidePosition) {
      let potentialZoom = 100 / (props.slidePosition.viewBoxWidth / props.slidePosition.width);
      potentialZoom = Math.max(HUNDRED_PERCENT, Math.min(MAX_PERCENT, potentialZoom));
      stateChange.zoom = potentialZoom;
    }

    if (!prevProps) return stateChange;

    // When presenter is changed or slide changed we reset localPosition
    if (prevProps.currentSlide.id !== props.currentSlide.id
      || prevProps.userIsPresenter !== props.userIsPresenter) {
      stateChange.localPosition = undefined;
    }

    return stateChange;
  }

  componentDidMount() {
    // adding an event listener to scale the whiteboard on 'resize' events sent by chat/userlist etc
    window.addEventListener('resize', this.onResize);
    this.getInitialPresentationSizes();
    this.refPresentationContainer.addEventListener('fullscreenchange', this.onFullscreenChange);

    const { slidePosition, webcamDraggableDispatch } = this.props;
    const { width: currWidth, height: currHeight } = slidePosition;
    if (currWidth > currHeight || currWidth === currHeight) {
      webcamDraggableDispatch({ type: 'setOrientationToLandscape' });
    }
    if (currHeight > currWidth) {
      webcamDraggableDispatch({ type: 'setOrientationToPortrait' });
    }
  }

  componentDidUpdate(prevProps) {
    const {
      currentPresentation,
      slidePosition,
      webcamDraggableDispatch,
      layoutSwapped,
      currentSlide,
      publishedPoll,
      isViewer,
      toggleSwapLayout,
      restoreOnUpdate,
    } = this.props;

    const { width: prevWidth, height: prevHeight } = prevProps.slidePosition;
    const { width: currWidth, height: currHeight } = slidePosition;

    if (prevWidth !== currWidth || prevHeight !== currHeight) {
      if (currWidth > currHeight || currWidth === currHeight) {
        webcamDraggableDispatch({ type: 'setOrientationToLandscape' });
      }
      if (currHeight > currWidth) {
        webcamDraggableDispatch({ type: 'setOrientationToPortrait' });
      }
    }

    if (prevProps.currentPresentation.name !== currentPresentation.name) {
      if (this.currentPresentationToastId) {
        return toast.update(this.currentPresentationToastId, {
          render: this.renderCurrentPresentationToast(),
        });
      }

      this.currentPresentationToastId = toast(this.renderCurrentPresentationToast(), {
        onClose: () => { this.currentPresentationToastId = null; },
        autoClose: true,
      });
    }

    if (layoutSwapped && restoreOnUpdate && isViewer && currentSlide) {
      const slideChanged = currentSlide.id !== prevProps.currentSlide.id;
      const positionChanged = slidePosition.viewBoxHeight !== prevProps.slidePosition.viewBoxHeight
        || slidePosition.viewBoxWidth !== prevProps.slidePosition.viewBoxWidth;
      const pollPublished = publishedPoll && !prevProps.publishedPoll;
      if (slideChanged || positionChanged || pollPublished || presentationChanged) {
        toggleSwapLayout();
      }
    }
  }

  componentWillUnmount() {
    window.removeEventListener('resize', this.onResize);
    this.refPresentationContainer.removeEventListener('fullscreenchange', this.onFullscreenChange);
  }

  onFullscreenChange() {
    const { isFullscreen } = this.state;
    const newIsFullscreen = FullscreenService.isFullScreen(this.refPresentationContainer);
    if (isFullscreen !== newIsFullscreen) {
      this.setState({ isFullscreen: newIsFullscreen });
      window.dispatchEvent(new Event('resize'));
    }
  }

  // returns a ref to the svg element, which is required by a WhiteboardOverlay
  // to transform screen coordinates to svg coordinate system
  getSvgRef() {
    return this.svggroup;
  }

  getToolbarHeight() {
    const { refPresentationToolbar } = this;
    let height = 0;
    if (refPresentationToolbar) {
      const { clientHeight } = refPresentationToolbar;
      height = clientHeight;
    }
    return height;
  }

  getPresentationSizesAvailable() {
    const { userIsPresenter, multiUser } = this.props;
    const { refPresentationArea, refWhiteboardArea } = this;
    const presentationSizes = {};

    if (refPresentationArea && refWhiteboardArea) {
      // By default presentation sizes are equal to the sizes of the refPresentationArea
      // direct parent of the svg wrapper
      let { clientWidth, clientHeight } = refPresentationArea;

      // if a user is a presenter - this means there is a whiteboard toolbar on the right
      // and we have to get the width/height of the refWhiteboardArea
      // (inner hidden div with absolute position)
      if (userIsPresenter || multiUser) {
        ({ clientWidth, clientHeight } = refWhiteboardArea);
      }

      presentationSizes.presentationAreaHeight = clientHeight - this.getToolbarHeight();
      presentationSizes.presentationAreaWidth = clientWidth;
    }
    return presentationSizes;
  }

  getInitialPresentationSizes() {
    // determining the presentationAreaWidth and presentationAreaHeight (available
    // space for the svg) on the initial load

    const presentationSizes = this.getPresentationSizesAvailable();
    if (Object.keys(presentationSizes).length > 0) {
      // setting the state of the available space for the svg
      // and set the showSlide to true to start rendering the slide
      this.setState({
        presentationAreaHeight: presentationSizes.presentationAreaHeight,
        presentationAreaWidth: presentationSizes.presentationAreaWidth,
        showSlide: true,
      });
    }
  }

  setFitToWidth(fitToWidth) {
    this.setState({ fitToWidth });
  }

  handleResize() {
    const presentationSizes = this.getPresentationSizesAvailable();
    if (Object.keys(presentationSizes).length > 0) {
      // updating the size of the space available for the slide
      this.setState({
        presentationAreaHeight: presentationSizes.presentationAreaHeight,
        presentationAreaWidth: presentationSizes.presentationAreaWidth,
      });
    }
  }

  calculateSize(viewBoxDimensions) {
    const {
      presentationAreaHeight,
      presentationAreaWidth,
      fitToWidth,
    } = this.state;

    const {
      userIsPresenter,
      currentSlide,
      slidePosition,
    } = this.props;

    if (!currentSlide || !slidePosition) {
      return { width: 0, height: 0 };
    }

    const originalWidth = slidePosition.width;
    const originalHeight = slidePosition.height;
    const viewBoxWidth = viewBoxDimensions.width;
    const viewBoxHeight = viewBoxDimensions.height;

    let svgWidth;
    let svgHeight;

    if (!userIsPresenter) {
      svgWidth = (presentationAreaHeight * viewBoxWidth) / viewBoxHeight;
      if (presentationAreaWidth < svgWidth) {
        svgHeight = (presentationAreaHeight * presentationAreaWidth) / svgWidth;
        svgWidth = presentationAreaWidth;
      } else {
        svgHeight = presentationAreaHeight;
      }
    } else if (!fitToWidth) {
      svgWidth = (presentationAreaHeight * originalWidth) / originalHeight;
      if (presentationAreaWidth < svgWidth) {
        svgHeight = (presentationAreaHeight * presentationAreaWidth) / svgWidth;
        svgWidth = presentationAreaWidth;
      } else {
        svgHeight = presentationAreaHeight;
      }
    } else {
      svgWidth = presentationAreaWidth;
      svgHeight = (svgWidth * originalHeight) / originalWidth;
      if (svgHeight > presentationAreaHeight) svgHeight = presentationAreaHeight;
    }

    return {
      width: svgWidth,
      height: svgHeight,
    };
  }

  zoomChanger(incomingZoom) {
    const {
      zoom,
    } = this.state;

    let newZoom = incomingZoom;

    if (newZoom <= HUNDRED_PERCENT) {
      newZoom = HUNDRED_PERCENT;
    } else if (incomingZoom >= MAX_PERCENT) {
      newZoom = MAX_PERCENT;
    }

    if (newZoom !== zoom) this.setState({ zoom: newZoom });
  }

  fitToWidthHandler() {
    const {
      fitToWidth,
    } = this.state;

    this.setState({
      fitToWidth: !fitToWidth,
      zoom: HUNDRED_PERCENT,
    });
  }

  isPresentationAccessible() {
    const {
      currentSlide,
      slidePosition,
    } = this.props;
    // sometimes tomcat publishes the slide url, but the actual file is not accessible
    return currentSlide && slidePosition;
  }

  updateLocalPosition(x, y, width, height, zoom) {
    this.setState({
      localPosition: {
        x, y, width, height,
      },
      zoom,
    });
  }

  panAndZoomChanger(w, h, x, y) {
    const {
      currentSlide,
      podId,
      zoomSlide,
    } = this.props;

    zoomSlide(currentSlide.num, podId, w, h, x, y);
  }

  renderPresentationClose() {
    const { isFullscreen } = this.state;
    if (!shouldEnableSwapLayout() || isFullscreen) {
      return null;
    }
    return <PresentationCloseButton toggleSwapLayout={MediaService.toggleSwapLayout} />;
  }

  renderOverlays(slideObj, svgDimensions, viewBoxPosition, viewBoxDimensions, physicalDimensions) {
    const {
      userIsPresenter,
      multiUser,
      podId,
      currentSlide,
      slidePosition,
    } = this.props;

    const {
      zoom,
      fitToWidth,
    } = this.state;

    if (!userIsPresenter && !multiUser) {
      return null;
    }

    // retrieving the pre-calculated data from the slide object
    const {
      width,
      height,
    } = slidePosition;

    return (
      <PresentationOverlayContainer
        podId={podId}
        userIsPresenter={userIsPresenter}
        currentSlideNum={currentSlide.num}
        slide={slideObj}
        slideWidth={width}
        slideHeight={height}
        viewBoxX={viewBoxPosition.x}
        viewBoxY={viewBoxPosition.y}
        viewBoxWidth={viewBoxDimensions.width}
        viewBoxHeight={viewBoxDimensions.height}
        physicalSlideWidth={physicalDimensions.width}
        physicalSlideHeight={physicalDimensions.height}
        svgWidth={svgDimensions.width}
        svgHeight={svgDimensions.height}
        zoom={zoom}
        zoomChanger={this.zoomChanger}
        updateLocalPosition={this.updateLocalPosition}
        panAndZoomChanger={this.panAndZoomChanger}
        getSvgRef={this.getSvgRef}
        fitToWidth={fitToWidth}
      >
        <WhiteboardOverlayContainer
          getSvgRef={this.getSvgRef}
          userIsPresenter={userIsPresenter}
          whiteboardId={slideObj.id}
          slide={slideObj}
          slideWidth={width}
          slideHeight={height}
          viewBoxX={viewBoxPosition.x}
          viewBoxY={viewBoxPosition.y}
          viewBoxWidth={viewBoxDimensions.width}
          viewBoxHeight={viewBoxDimensions.height}
          physicalSlideWidth={physicalDimensions.width}
          physicalSlideHeight={physicalDimensions.height}
          zoom={zoom}
          zoomChanger={this.zoomChanger}
        />
      </PresentationOverlayContainer>
    );
  }

  // renders the whole presentation area
  renderPresentationArea(svgDimensions, viewBoxDimensions) {
    const {
      podId,
      currentSlide,
      slidePosition,
      userIsPresenter,
      layoutSwapped,
    } = this.props;

    const {
      localPosition,
    } = this.state;

    if (!this.isPresentationAccessible()) {
      return null;
    }

    // retrieving the pre-calculated data from the slide object
    const {
      width,
      height,
    } = slidePosition;

    const {
      imageUri,
    } = currentSlide;

    let viewBoxPosition;

    if (userIsPresenter && localPosition) {
      viewBoxPosition = {
        x: localPosition.x,
        y: localPosition.y,
      };
    } else {
      viewBoxPosition = {
        x: slidePosition.x,
        y: slidePosition.y,
      };
    }

    const widthRatio = viewBoxDimensions.width / width;
    const heightRatio = viewBoxDimensions.height / height;

    const physicalDimensions = {
      width: (svgDimensions.width / widthRatio),
      height: (svgDimensions.height / heightRatio),
    };

    const svgViewBox = `${viewBoxPosition.x} ${viewBoxPosition.y} `
      + `${viewBoxDimensions.width} ${Number.isNaN(viewBoxDimensions.height) ? 0 : viewBoxDimensions.height}`;

    return (
      <div
        style={{
          position: 'absolute',
          width: svgDimensions.width,
          height: svgDimensions.height,
          textAlign: 'center',
          display: layoutSwapped ? 'none' : 'block',
        }}
      >
        {this.renderPresentationClose()}
        {this.renderPresentationDownload()}
        {this.renderPresentationFullscreen()}
        <svg
          key={currentSlide.id}
          data-test="whiteboard"
          width={svgDimensions.width}
          height={svgDimensions.height}
          ref={(ref) => { if (ref != null) { this.svggroup = ref; } }}
          viewBox={svgViewBox}
          version="1.1"
          xmlns="http://www.w3.org/2000/svg"
          className={styles.svgStyles}
        >
          <defs>
            <clipPath id="viewBox">
              <rect x={viewBoxPosition.x} y={viewBoxPosition.y} width="100%" height="100%" fill="none" />
            </clipPath>
          </defs>
          <g clipPath="url(#viewBox)">
            <Slide
              imageUri={imageUri}
              svgWidth={width}
              svgHeight={height}
            />
            <AnnotationGroupContainer
              {...{
                width,
                height,
              }}
              published
              whiteboardId={currentSlide.id}
            />
            <AnnotationGroupContainer
              {...{
                width,
                height,
              }}
              published={false}
              whiteboardId={currentSlide.id}
            />
            <CursorWrapperContainer
              podId={podId}
              whiteboardId={currentSlide.id}
              widthRatio={widthRatio}
              physicalWidthRatio={svgDimensions.width / width}
              slideWidth={width}
              slideHeight={height}
            />
          </g>
          {this.renderOverlays(
            currentSlide,
            svgDimensions,
            viewBoxPosition,
            viewBoxDimensions,
            physicalDimensions,
          )}
        </svg>
      </div>
    );
  }

  renderPresentationToolbar() {
    const {
      currentSlide,
      podId,
    } = this.props;

    const { zoom, fitToWidth, isFullscreen } = this.state;

    if (!currentSlide) {
      return null;
    }

    return (
      <PresentationToolbarContainer
        {...{
          fitToWidth,
          zoom,
          podId,
          currentSlide,
        }}
        isFullscreen={isFullscreen}
        fullscreenRef={this.refPresentationContainer}
        currentSlideNum={currentSlide.num}
        presentationId={currentSlide.presentationId}
        zoomChanger={this.zoomChanger}
        fitToWidthHandler={this.fitToWidthHandler}
      />
    );
  }

  renderWhiteboardToolbar(svgDimensions) {
    const { currentSlide } = this.props;
    if (!this.isPresentationAccessible()) return null;

    return (
      <WhiteboardToolbarContainer
        whiteboardId={currentSlide.id}
        height={svgDimensions.height}
      />
    );
  }

  renderPresentationDownload() {
    const { presentationIsDownloadable, downloadPresentationUri } = this.props;

    if (!presentationIsDownloadable) return null;

    const handleDownloadPresentation = () => {
      window.open(downloadPresentationUri);
    };

    return (
      <DownloadPresentationButton
        handleDownloadPresentation={handleDownloadPresentation}
        dark
      />
    );
  }

  renderPresentationFullscreen() {
    const {
      intl,
      userIsPresenter,
    } = this.props;
    const { isFullscreen } = this.state;

    if (userIsPresenter || !ALLOW_FULLSCREEN) return null;

    return (
      <FullscreenButtonContainer
        fullscreenRef={this.refPresentationContainer}
        elementName={intl.formatMessage(intlMessages.presentationLabel)}
        isFullscreen={isFullscreen}
        dark
        bottom
      />
    );
  }

  renderCurrentPresentationToast() {
    const { intl, currentPresentation } = this.props;

    return (
      <div className={styles.innerToastWrapper}>
        <div className={styles.toastIcon}>
          <div className={styles.iconWrapper}>
            <Icon iconName="presentation" />
          </div>
        </div>
        <div className={styles.toastTextContent}>
          <div>{`${intl.formatMessage(intlMessages.changeNotification)}`}</div>
          <div className={styles.presentationName}>{`${currentPresentation.name}`}</div>
        </div>
      </div>
    );
  }

  render() {
    const {
      userIsPresenter,
      multiUser,
      slidePosition,
    } = this.props;

    const {
      showSlide,
      fitToWidth,
      presentationAreaWidth,
      localPosition,
    } = this.state;

    let viewBoxDimensions;

    if (userIsPresenter && localPosition) {
      viewBoxDimensions = {
        width: localPosition.width,
        height: localPosition.height,
      };
    } else if (slidePosition) {
      viewBoxDimensions = {
        width: slidePosition.viewBoxWidth,
        height: slidePosition.viewBoxHeight,
      };
    } else {
      viewBoxDimensions = {
        width: 0,
        height: 0,
      };
    }

    const svgDimensions = this.calculateSize(viewBoxDimensions);
    const svgHeight = svgDimensions.height;
    const svgWidth = svgDimensions.width;

    const toolbarHeight = this.getToolbarHeight();

    let toolbarWidth = 0;
    if (this.refWhiteboardArea) {
      if (svgWidth === presentationAreaWidth
        || presentationAreaWidth <= 400
        || fitToWidth === true) {
        toolbarWidth = '100%';
      } else if (svgWidth <= 400
        && presentationAreaWidth > 400) {
        toolbarWidth = '400px';
      } else {
        toolbarWidth = svgWidth;
      }
    }

    return (
      <div
        ref={(ref) => { this.refPresentationContainer = ref; }}
        className={styles.presentationContainer}
      >
        <div
          ref={(ref) => { this.refPresentationArea = ref; }}
          className={styles.presentationArea}
        >
          <div
            ref={(ref) => { this.refWhiteboardArea = ref; }}
            className={styles.whiteboardSizeAvailable}
          />
          <div
            className={styles.svgContainer}
            style={{
              height: svgHeight + toolbarHeight,
            }}
          >
            {showSlide
              ? this.renderPresentationArea(svgDimensions, viewBoxDimensions)
              : null}
            {showSlide && (userIsPresenter || multiUser)
              ? this.renderWhiteboardToolbar(svgDimensions)
              : null}
            {showSlide && userIsPresenter
              ? (
                <div
                  className={styles.presentationToolbar}
                  ref={(ref) => { this.refPresentationToolbar = ref; }}
                  style={
                    {
                      width: toolbarWidth,
                    }
                  }
                >
                  {this.renderPresentationToolbar()}
                </div>
              )
              : null}
          </div>
        </div>
      </div>
    );
  }
}

export default injectIntl(withDraggableConsumer(PresentationArea));

PresentationArea.propTypes = {
  intl: intlShape.isRequired,
  podId: PropTypes.string.isRequired,
  // Defines a boolean value to detect whether a current user is a presenter
  userIsPresenter: PropTypes.bool.isRequired,
  currentSlide: PropTypes.shape({
    presentationId: PropTypes.string.isRequired,
    current: PropTypes.bool.isRequired,
    num: PropTypes.number.isRequired,
    id: PropTypes.string.isRequired,
    imageUri: PropTypes.string.isRequired,
  }),
  slidePosition: PropTypes.shape({
    x: PropTypes.number.isRequired,
    y: PropTypes.number.isRequired,
    height: PropTypes.number.isRequired,
    width: PropTypes.number.isRequired,
    viewBoxWidth: PropTypes.number.isRequired,
    viewBoxHeight: PropTypes.number.isRequired,
  }),
  // current multi-user status
  multiUser: PropTypes.bool.isRequired,
};

PresentationArea.defaultProps = {
  currentSlide: undefined,
  slidePosition: undefined,
};
