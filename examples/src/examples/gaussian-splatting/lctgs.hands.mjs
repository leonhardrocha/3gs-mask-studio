import * as pc from 'playcanvas';

const createControllerEntity = ({ cameraParent, inputSource, controllerModelEnabled, controllerModelAsset }) => {
    const entity = new pc.Entity();

    if (inputSource.hand) {
        entity.joints = [];

        const material = new pc.StandardMaterial();
        for (let i = 0; i < inputSource.hand.joints.length; i++) {
            const joint = inputSource.hand.joints[i];
            const jointEntity = new pc.Entity();
            jointEntity.addComponent('model', {
                type: 'box',
                material
            });
            jointEntity.joint = joint;
            entity.joints.push(jointEntity);
            entity.addChild(jointEntity);
        }

        inputSource.hand.on('trackinglost', () => {
            entity.joints[0].model.material.diffuse.set(1, 0, 0);
            entity.joints[0].model.material.update();
        });

        inputSource.hand.on('tracking', () => {
            entity.joints[0].model.material.diffuse.set(1, 1, 1);
            entity.joints[0].model.material.update();
        });
    } else if (controllerModelEnabled && controllerModelAsset?.resource?.model) {
        entity.addComponent('model', {
            type: 'asset',
            asset: controllerModelAsset.resource.model,
            castShadows: true
        });
        entity.setLocalScale(1, 1, 1);
    } else {
        entity.addComponent('render', {
            type: 'box'
        });
        entity.setLocalScale(0.05, 0.05, 0.05);
    }

    cameraParent.addChild(entity);
    entity.inputSource = inputSource;

    return entity;
};

const updateControllers = ({ app, controllers, rayVisible }) => {
    const rayEnd = new pc.Vec3();

    for (let i = 0; i < controllers.length; i++) {
        const entity = controllers[i];
        const inputSource = entity.inputSource;

        if (inputSource.hand) {
            entity.enabled = true;
            for (let j = 0; j < entity.joints.length; j++) {
                const joint = entity.joints[j].joint;
                const r = Math.max(0.001, (joint.radius ?? 0.01) * 2);
                entity.joints[j].setLocalScale(r, r, r);
                entity.joints[j].setPosition(joint.getPosition());
                entity.joints[j].setRotation(joint.getRotation());
            }
        } else if (inputSource.grip) {
            entity.enabled = true;
            entity.setLocalPosition(inputSource.getLocalPosition());
            entity.setLocalRotation(inputSource.getLocalRotation());
        } else {
            entity.enabled = false;
        }

        if (rayVisible && inputSource.targetRayMode === pc.XRTARGETRAY_POINTER) {
            rayEnd.copy(inputSource.getDirection()).add(inputSource.getOrigin());
            const color = inputSource.selecting ? pc.Color.GREEN : pc.Color.WHITE;
            app.drawLine(inputSource.getOrigin(), rayEnd, color);
        }
    }
};

const getPreferredPaintInputSource = (controllers) => {
    // Prefer right hand/controller for painting.
    for (let i = 0; i < controllers.length; i++) {
        const inputSource = controllers[i].inputSource;
        if (inputSource?.handedness === pc.XRHAND_RIGHT) {
            return inputSource;
        }
    }

    return controllers[0]?.inputSource;
};

export { createControllerEntity, updateControllers, getPreferredPaintInputSource };
