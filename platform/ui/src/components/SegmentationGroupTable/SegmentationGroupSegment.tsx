import React, { useState } from 'react';
import PropTypes from 'prop-types';
import classnames from 'classnames';

import Icon from '../Icon';

const SegmentItem = ({
  segmentIndex,
  segmentationId,
  label,
  isActive,
  isVisible,
  color,
  showDelete,
  disableEditing,
  isLocked = false,
  onClick,
  onEdit,
  onDelete,
  onColor,
  onToggleVisibility,
  onToggleLocked,
}) => {
  const [isRowHovering, setRowIsHovering] = useState(false);
  const [isNumberBoxHovering, setIsNumberBoxHovering] = useState(false);

  const cssColor = `rgb(${color[0]},${color[1]},${color[2]})`;

  return (
    <div
      className={classnames('text-aqua-pale group/row flex min-h-[28px] bg-black')}
      onMouseEnter={() => setRowIsHovering(true)}
      onMouseLeave={() => setRowIsHovering(false)}
      onClick={e => {
        e.stopPropagation();
        onClick(segmentationId, segmentIndex);
      }}
      tabIndex={0}
      data-cy={'segment-item'}
    >
      <div
        className={classnames('bg-primary-dark group/number grid w-[32px] place-items-center', {
          'bg-primary-light border-primary-light rounded-l-[4px] border text-black': isActive,
          'border-primary-dark border': !isActive,
        })}
        onMouseEnter={() => setIsNumberBoxHovering(true)}
        onMouseLeave={() => setIsNumberBoxHovering(false)}
      >
        {isNumberBoxHovering && showDelete ? (
          <Icon
            name="close"
            className={classnames('h-[8px] w-[8px]', {
              'hover:cursor-pointer hover:opacity-60': !disableEditing,
            })}
            onClick={e => {
              if (disableEditing) {
                return;
              }
              e.stopPropagation();
              onDelete(segmentationId, segmentIndex);
            }}
          />
        ) : (
          <div>{segmentIndex}</div>
        )}
      </div>
      <div
        className={classnames('relative flex w-full', {
          'border-primary-light bg-primary-dark rounded-r-[4px] border border-l-0': isActive,
          'border border-l-0 border-transparent': !isActive,
        })}
      >
        <div className="group-hover/row:bg-primary-dark flex h-full w-full flex-grow items-center">
          <div className="pl-2 pr-1.5">
            <div
              className={classnames('h-[8px] w-[8px] grow-0 rounded-full', {
                'hover:cursor-pointer hover:opacity-60': !disableEditing,
              })}
              style={{ backgroundColor: cssColor }}
              onClick={e => {
                if (disableEditing) {
                  return;
                }
                e.stopPropagation();
                onColor(segmentationId, segmentIndex);
              }}
            />
          </div>
          <div className="flex items-center py-1 hover:cursor-pointer">{label}</div>
        </div>
        <div
          className={classnames(
            'absolute right-0 top-0 flex flex-row-reverse rounded-lg pr-[8px] pt-[3px]',
            {}
          )}
        >
          {!isVisible && !isRowHovering && (
            <div>
              <Icon
                name="row-hidden"
                className={classnames('h-5 w-5 text-[#3d5871] ')}
                onClick={e => {
                  e.stopPropagation();
                  onToggleVisibility(segmentationId, segmentIndex);
                }}
              />
            </div>
          )}
          {isLocked && !isRowHovering && (
            <div className="flex">
              <div>
                <Icon
                  name="row-locked"
                  className={classnames('h-5 w-5')}
                  onClick={e => {
                    e.stopPropagation();
                    onToggleLocked(segmentationId, segmentIndex);
                  }}
                />
              </div>
              {isVisible && (
                <div>
                  <Icon
                    name="row-hidden"
                    className={classnames('h-5 w-5 opacity-0')}
                  />
                </div>
              )}
            </div>
          )}
          {isRowHovering && (
            <HoveringIcons
              onEdit={onEdit}
              isLocked={isLocked}
              isVisible={isVisible}
              onToggleLocked={onToggleLocked}
              onToggleVisibility={onToggleVisibility}
              segmentationId={segmentationId}
              segmentIndex={segmentIndex}
            />
          )}
        </div>
      </div>
    </div>
  );
};

const HoveringIcons = ({
  onEdit,
  isLocked,
  isVisible,
  onToggleLocked,
  onToggleVisibility,
  segmentationId,
  segmentIndex,
}) => {
  const iconClass = 'w-5 h-5 hover:cursor-pointer hover:opacity-60 text-white';

  const handleIconClick = (e, action) => {
    e.stopPropagation();
    action(segmentationId, segmentIndex);
  };

  const createIcon = (name, action) => (
    <Icon
      name={name}
      className={iconClass}
      onClick={e => handleIconClick(e, action)}
    />
  );

  return (
    <div className="flex items-center">
      {createIcon('row-edit', onEdit)}
      {createIcon(isLocked ? 'row-locked' : 'row-unlocked', onToggleLocked)}
      {createIcon(isVisible ? 'row-hide' : 'row-unhide', onToggleVisibility)}
    </div>
  );
};

SegmentItem.propTypes = {
  segmentIndex: PropTypes.number.isRequired,
  segmentationId: PropTypes.string.isRequired,
  label: PropTypes.string,
  disableEditing: PropTypes.bool,
  // color as array
  color: PropTypes.array,
  isActive: PropTypes.bool.isRequired,
  isVisible: PropTypes.bool.isRequired,
  isLocked: PropTypes.bool,
  onClick: PropTypes.func.isRequired,
  onEdit: PropTypes.func.isRequired,
  onDelete: PropTypes.func.isRequired,
  onToggleVisibility: PropTypes.func.isRequired,
  onToggleLocked: PropTypes.func,
};

SegmentItem.defaultProps = {
  isActive: false,
};

export default SegmentItem;
