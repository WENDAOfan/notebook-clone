package com.example.notebook_clone.service;

import com.example.notebook_clone.entity.User;
import com.example.notebook_clone.repository.UserRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;

import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * AuthService 的纯单元测试。
 *
 * 与 Web 安全测试不同，这里不启动 Spring，也不模拟 HTTP 请求，而是直接调用
 * register() 和 login()。UserRepository 使用 Mock，密码编码器使用真实 BCrypt 实现。
 */
@ExtendWith(MockitoExtension.class)
class AuthServiceTests {

    @Mock
    private UserRepository userRepository;

    private PasswordEncoder passwordEncoder;
    private AuthService authService;

    @BeforeEach
    void setUp() {
        passwordEncoder = new BCryptPasswordEncoder();
        authService = new AuthService(userRepository, passwordEncoder);
    }

    /** 注册时不能把明文密码直接保存到数据库。 */
    @Test
    void registerEncryptsPasswordBeforeSaving() {
        // Arrange：用户名可用；save() 返回传入的 User，模拟数据库保存成功
        when(userRepository.existsByUsername("alice")).thenReturn(false);
        when(userRepository.save(any(User.class)))
                .thenAnswer(invocation -> invocation.getArgument(0));

        // Act：直接调用被测试方法
        User registeredUser = authService.register("alice", "123456");

        // Assert：返回值中的密码不再是明文，但 BCrypt 仍能验证原密码
        assertNotEquals("123456", registeredUser.getPassword());
        assertTrue(passwordEncoder.matches("123456", registeredUser.getPassword()));

        // 捕获真正传给 Repository 的对象，确认写入数据库前就已经完成加密
        ArgumentCaptor<User> userCaptor = ArgumentCaptor.forClass(User.class);
        verify(userRepository).save(userCaptor.capture());
        User savedUser = userCaptor.getValue();
        assertEquals("alice", savedUser.getUsername());
        assertTrue(passwordEncoder.matches("123456", savedUser.getPassword()));
    }

    /** 重复用户名必须在保存前被拒绝。 */
    @Test
    void registerRejectsDuplicateUsernameWithoutSaving() {
        when(userRepository.existsByUsername("alice")).thenReturn(true);

        RuntimeException exception = assertThrows(
                RuntimeException.class,
                () -> authService.register("alice", "123456"));

        assertEquals("用户名已被注册", exception.getMessage());
        // 验证失败后没有产生数据库写入副作用
        verify(userRepository, never()).save(any(User.class));
    }

    /** 数据库中的 BCrypt 密文与输入密码匹配时，返回对应用户。 */
    @Test
    void loginReturnsUserWhenPasswordMatches() {
        User storedUser = storedUser("alice", "123456");
        when(userRepository.findByUsername("alice")).thenReturn(Optional.of(storedUser));

        User loggedInUser = authService.login("alice", "123456");

        assertSame(storedUser, loggedInUser);
    }

    /** 密码错误时不能登录，并且不暴露“用户名存在但密码错误”这一细节。 */
    @Test
    void loginRejectsWrongPasswordWithGenericMessage() {
        User storedUser = storedUser("alice", "123456");
        when(userRepository.findByUsername("alice")).thenReturn(Optional.of(storedUser));

        RuntimeException exception = assertThrows(
                RuntimeException.class,
                () -> authService.login("alice", "wrong-password"));

        assertEquals("用户名或密码错误", exception.getMessage());
    }

    /** 创建带 BCrypt 密码的模拟数据库用户，供登录测试复用。 */
    private User storedUser(String username, String rawPassword) {
        User user = new User();
        user.setId(1L);
        user.setUsername(username);
        user.setPassword(passwordEncoder.encode(rawPassword));
        return user;
    }
}
