package com.example.notebook_clone.service;

import com.example.notebook_clone.entity.User;
import com.example.notebook_clone.repository.UserRepository;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;

@Service
public class AuthService {

    private final UserRepository userRepository;
    private final PasswordEncoder passwordEncoder;

    // 构造器注入（Spring 会自动注入 Bean）
    public AuthService(UserRepository userRepository, PasswordEncoder passwordEncoder) {
        this.userRepository = userRepository;
        this.passwordEncoder = passwordEncoder;
    }

    /**
     * 用户注册
     * @param username 用户名
     * @param password 明文密码
     * @return 注册成功的用户（密码已加密）
     */
    public User register(String username, String password) {
        // 1. 检查用户名是否已存在
        if (userRepository.existsByUsername(username)) {
            throw new RuntimeException("用户名已被注册");
        }

        // 2. 创建用户实体
        User user = new User();
        user.setUsername(username);
        
        // 3. 使用 BCrypt 加密密码（关键！）
        String encryptedPassword = passwordEncoder.encode(password);
        user.setPassword(encryptedPassword);

        // 4. 保存到数据库
        return userRepository.save(user);
    }

    /**
     * 用户登录（校验用户名和密码）
     * @param username 用户名
     * @param password 明文密码（用户输入的）
     * @return 登录成功的用户
     */
    public User login(String username, String password) {
        // 1. 查找用户
        User user = userRepository.findByUsername(username)
                .orElseThrow(() -> new RuntimeException("用户名或密码错误"));

        // 2. 校验密码（关键！）
        // passwordEncoder.matches(明文, 密文) → 返回 true/false
        if (!passwordEncoder.matches(password, user.getPassword())) {
            throw new RuntimeException("用户名或密码错误");
        }

        // 3. 登录成功，返回用户信息
        return user;
    }
}