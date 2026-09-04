package com.example.notebook_clone.security;

import com.example.notebook_clone.controller.EvalRetrievalController;
import org.junit.jupiter.api.Test;
import org.springframework.context.annotation.Profile;

import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;

/** 不启动 Spring，直接锁定 Controller 的 Profile 发布边界。 */
class EvalRetrievalProfileTests {

    @Test
    void controllerIsOnlyAvailableInEvalOrTestProfiles() {
        Profile profile = EvalRetrievalController.class.getAnnotation(Profile.class);

        assertNotNull(profile);
        assertEquals(Set.of("eval", "test"), Set.of(profile.value()));
    }
}
